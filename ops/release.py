"""Local release controller. Status is offline; no implicit provision, migration or retry."""
import argparse
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

API = 'https://serverless-functions.api.cloud.yandex.net/functions/v1/'
OPS = ('status', 'preflight', 'build', 'provision', 'migrate', 'deploy', 'verify', 'rollback', 'handoff')
ALLOWED_DIRS = {'lib', 'src', 'tgcloud', 'adapters', 'certs', 'niches', 'assets', 'migrations', 'test', 'tests', 'scripts', 'ops', 'docs', 'runtime', 'vendor-core'}
ALLOWED_ROOT = {'index.js', 'worker.js', 'package.json', 'package-lock.json', 'README.md', 'RUNBOOK.md', 'AGENTS.md', 'ARCHITECTURE.md', 'LICENSE', '.gitignore', '.nvmrc', '.github/workflows/check.yml', 'tsconfig.json', 'tsconfig.esm.json'}

class Stop(Exception):
    pass

def require(ok, reason):
    if not ok:
        raise Stop(reason)

def run(args, root, env=None):
    result = subprocess.run(args, cwd=root, capture_output=True, timeout=600, env=env)
    require(result.returncode == 0, 'command_failed:' + Path(args[0]).name)
    return result.stdout.decode().strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def load_config(root, filename):
    require(bool(filename), 'explicit_config_required')
    path = Path(filename)
    path = path if path.is_absolute() else root / path
    cfg = json.loads(path.read_text())
    allowed = {'client', 'environment', 'provider', 'remote', 'functionId', 'folderId', 'serviceAccountId', 'entrypoint', 'memory', 'timeout', 'environmentVariables', 'secretEnvironment', 'botIdentities', 'migrationIds', 'appId', 'expectedRevision'}
    require(set(cfg) <= allowed, 'unknown_config_fields_may_contain_credentials')
    require(not re.search(r'https?://[^/]*@', cfg.get('remote', '')), 'remote_must_not_contain_credentials')
    require('REPLACE' not in json.dumps(cfg), 'complete_client_configuration_first')
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{1,48}', cfg.get('client', '')), 'invalid_client')
    require(cfg.get('environment') in ('staging', 'production'), 'explicit_environment_required')
    require(cfg.get('provider') in ('ycf', 'telegram'), 'invalid_provider')
    require(bool(cfg.get('remote')), 'canonical_remote_required')
    env = cfg.get('environmentVariables', {})
    require(isinstance(env, dict) and all(isinstance(k, str) and re.fullmatch(r'[A-Z_][A-Z0-9_]*', k) and isinstance(v, str) for k, v in env.items()), 'invalid_runtime_environment')
    require(all(not re.search(r'TOKEN|SECRET|PASSWORD|CREDENTIAL|(?:^|_)KEY(?:_|$)|AUTH', k, re.I) for k in env), 'secret_values_must_be_external')
    secrets = cfg.get('secretEnvironment', {})
    require(isinstance(secrets, dict) and all(isinstance(k, str) and re.fullmatch(r'[A-Z_][A-Z0-9_]*', k) and isinstance(v, str) and re.fullmatch(r'DEPLOY_[A-Z_][A-Z0-9_]*', v) for k, v in secrets.items()), 'secret_sources_must_be_deploy_environment_names')
    require(not set(env) & set(secrets), 'duplicate_runtime_environment')
    require(not {'IAM_TOKEN', 'YC_IAM_TOKEN', 'TGCLOUD_TOKEN', 'NODE_TLS_REJECT_UNAUTHORIZED'} & (set(env) | set(secrets)), 'unsafe_runtime_environment')
    if cfg['provider'] == 'ycf':
        require(all(re.fullmatch('[a-z0-9]{20}', cfg.get(k, '')) for k in ('functionId', 'folderId', 'serviceAccountId')), 'explicit_cloud_ids_required')
        require(cfg.get('entrypoint') in ('index.handler', 'worker.handler'), 'invalid_entrypoint')
        require(cfg.get('memory', 268435456) in (134217728, 268435456, 536870912), 'invalid_memory')
        require(re.fullmatch(r'(?:[1-9]|1[0-9]|2[0-5])s', cfg.get('timeout', '25s')), 'timeout_exceeds_webhook_budget')
    else:
        require(not env and not secrets, 'native_environment_is_platform_managed')
        require(re.fullmatch(r'app\d+', cfg.get('appId', '')), 'explicit_telegram_app_required')
        require(type(cfg.get('expectedRevision')) is int, 'explicit_remote_revision_required')
    return cfg

def source(root, cfg):
    require(not run(['git', 'status', '--porcelain', '--untracked-files=normal'], root), 'dirty_worktree')
    sha = run(['git', 'rev-parse', 'HEAD'], root)
    require(re.fullmatch('[a-f0-9]{40}', sha), 'invalid_source_sha')
    require(run(['git', 'remote', 'get-url', 'origin'], root) == cfg['remote'], 'wrong_repository')
    return sha

def safe_name(name):
    p = PurePosixPath(name)
    return (not p.is_absolute() and '..' not in p.parts and
        not any(x.startswith('.') and x not in ('.gitignore', '.nvmrc') and not (i == 0 and x == '.github') for i, x in enumerate(p.parts)) and
        'node_modules' not in p.parts and
        not re.search(r'credentials|leads[-_]?export|\.pem\.key$|\.log$|__pycache__|\.pyc$', name, re.I) and
        (p.parts[0] in ALLOWED_DIRS or name in ALLOWED_ROOT))

def archive(root, sha):
    names = run(['git', 'ls-tree', '-r', '--name-only', sha], root).splitlines()
    names = sorted(n for n in names if safe_name(n))
    require('package-lock.json' in names and 'package.json' in names, 'package_lock_required')
    output = subprocess.run(['git', 'archive', '--format=zip', sha, '--', *names], cwd=root, capture_output=True, check=True).stdout
    with zipfile.ZipFile(io.BytesIO(output)) as z:
        for info in z.infolist():
            require(info.is_dir() or safe_name(info.filename), 'unsafe_archive_member')
            require((info.external_attr >> 16) & 0o170000 != 0o120000, 'symlinks_forbidden')
            if not info.is_dir():
                require(not re.search(rb'y0_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b\d{8,12}:[A-Za-z0-9_-]{30,}', z.read(info)), 'secret_pattern_in_source')
    return output

def clean_env():
    # Tests/install scripts never inherit bot, cloud or database credentials.
    return {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT')} | {'npm_config_cache': '/private/tmp/bot-release-npm-cache'}

def build(root, cfg, sha, folder):
    require(run(['node', '-p', 'process.versions.node.split(".")[0]'], root) == '22', 'node22_required')
    data = archive(root, sha)
    with tempfile.TemporaryDirectory(prefix='bot-build-') as tmp:
        target = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(target)
        env = clean_env()
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], target, env)
        run(['npm', 'test'], target, env)
    require(source(root, cfg) == sha, 'source_changed_during_build')
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'source.zip').write_bytes(data)
    manifest = {'schema': 1, 'client': cfg['client'], 'environment': cfg['environment'], 'provider': cfg['provider'],
        'sourceSha': sha, 'sha256': digest(data), 'configSha256': digest(json.dumps(cfg, sort_keys=True).encode()),
        'nodeMajor': 22, 'tests': 'passed_in_isolated_source_archive'}
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest

def artifact(folder, cfg, sha):
    manifest = json.loads((folder / 'manifest.json').read_text())
    data = (folder / 'source.zip').read_bytes()
    require(manifest['sourceSha'] == sha and manifest['client'] == cfg['client'] and manifest['environment'] == cfg['environment'] and
        manifest['configSha256'] == digest(json.dumps(cfg, sort_keys=True).encode()) and manifest['sha256'] == digest(data), 'artifact_identity_mismatch')
    return data

def request(url, token, method='GET', body=None, envelope=False):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            result = json.load(response)
        if envelope:
            require(result.get('ok') is True, 'provider_rejected_operation')
            return result['result']
        return result
    except Exception:
        raise Stop('provider_request_failed' if method == 'GET' else 'provider_result_unknown_inspect_before_retry') from None

def cloud(cfg):
    token = os.environ.get('YC_IAM_TOKEN', '') if cfg['provider'] == 'ycf' else os.environ.get('TGCLOUD_TOKEN', '')
    require(bool(token), 'external_provider_token_required')
    if cfg['provider'] == 'ycf':
        fn = request(API + 'functions/' + cfg['functionId'], token)
        require(fn.get('id') == cfg['functionId'] and fn.get('folderId') == cfg['folderId'], 'wrong_cloud_function')
        return token, fn
    require(token.split(':')[0] == cfg['appId'], 'wrong_telegram_app')
    current = request('https://cloud.telegram.org/' + cfg['appId'] + '/manage/get', token, envelope=True)
    return token, current

def validate_runtime(root, cfg):
    descriptor = root / 'ops/runtime.json'
    require(descriptor.exists(), 'runtime_descriptor_required')
    runtime = json.loads(descriptor.read_text())
    require(cfg['provider'] in runtime['providers'], 'provider_not_supported_by_this_bot')
    if cfg['provider'] == 'telegram':
        operators = (root / 'tgcloud/lib/operator-config.js').read_text()
        for name in ('OWNER_CHAT_IDS', 'ADMIN_USER_IDS'):
            value = re.search(r'export const ' + name + r'\s*=\s*(\[[^\]]*\])', operators)
            require(value is not None, 'operator_configuration_required')
            values = json.loads(value[1])
            require(values and all(re.fullmatch(r'-?\d+', str(x)) for x in values), 'numeric_operator_configuration_required')
        for name in runtime.get('requiredNativeConstants', []):
            value = re.search(r'export const ' + name + r'\s*=\s*[\"\'](https://[^\"\']+)[\"\']', operators)
            require(value is not None, 'native_https_document_url_required')
    else:
        env = cfg.get('environmentVariables', {})
        refs = set(cfg.get('secretEnvironment', {}))
        require(all(env.get(k) for k in runtime['requiredEnvironment']), 'runtime_environment_incomplete')
        require(all(k in refs for k in runtime['requiredSecrets']), 'secret_environment_incomplete')
        variants = runtime.get('platformRequirements', {})
        enabled = [v for v in variants.values() if v['tokenVariable'] in refs]
        require(not variants or enabled, 'messenger_token_required')
        for variant in enabled:
            require(all(env.get(k) for k in variant['requiredEnvironment']), 'messenger_environment_incomplete')
            require(all(k in refs for k in variant['requiredSecrets']), 'messenger_secrets_incomplete')
        require(cfg.get('botIdentities'), 'trusted_bot_identity_required')
        token_refs = {k for k in refs if k.endswith('BOT_TOKEN')}
        require(token_refs == {i.get('secretVariable') for i in cfg['botIdentities']}, 'every_bot_token_needs_trusted_identity')
        for variable, name in runtime.get('identityEnvironment', {}).items():
            require(any(i.get('secretVariable') == variable and i.get('id') == env.get(name) for i in cfg['botIdentities']), 'runtime_bot_id_mismatch')
        for identity in cfg['botIdentities']:
            require(identity.get('platform') in ('max', 'telegram') and re.fullmatch(r'\d+', identity.get('id', '')) and identity.get('secretVariable') in refs, 'invalid_bot_identity')
    return runtime

def secret_values(cfg):
    # Resolve only for preflight/deploy/verify, never for builds, manifests or handoff.
    values = {}
    for name, source in cfg.get('secretEnvironment', {}).items():
        value = os.environ.get(source, '')
        require(bool(value), 'required_deploy_secret_missing')
        if 'WEBHOOK_SECRET' in name or name == 'BOT_DATA_SECRET':
            require(len(value) >= 32, 'secrets_need_at_least_32_characters')
        if 'WEBHOOK_SECRET' in name:
            require(re.fullmatch(r'[A-Za-z0-9_-]{32,256}', value), 'webhook_secret_must_be_ascii_urlsafe_32_to_256')
        values[name] = value
    return values

def verify_cloud_runtime(root, cfg, token):
    if cfg['provider'] != 'ycf':
        return
    account = request('https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts/' + cfg['serviceAccountId'], token)
    require(account.get('folderId') == cfg['folderId'], 'service_account_outside_client_folder')
    if cfg['entrypoint'] == 'worker.handler':
        bindings = request(API + 'functions/' + cfg['functionId'] + ':listAccessBindings', token)
        require(not any(x.get('subject', {}).get('id') in ('allUsers', 'allAuthenticatedUsers') for x in bindings.get('accessBindings', [])), 'worker_must_be_private')
    values = secret_values(cfg)
    for identity in cfg['botIdentities']:
        credential = values[identity['secretVariable']]
        try:
            if identity['platform'] == 'max':
                context = ssl.create_default_context()
                context.load_verify_locations(cafile=str(root / 'certs/russian_trusted_root_ca.pem'))
                req = urllib.request.Request('https://platform-api2.max.ru/me', headers={'Authorization': credential})
                with urllib.request.urlopen(req, timeout=10, context=context) as response:
                    bot = json.load(response)
                require(str(bot.get('user_id')) == identity['id'] and bot.get('is_bot') is True, 'wrong_max_bot')
            else:
                with urllib.request.urlopen('https://api.telegram.org/bot' + credential + '/getMe', timeout=10) as response:
                    bot = json.load(response)
                require(bot.get('ok') is True and str(bot.get('result', {}).get('id')) == identity['id'] and bot.get('result', {}).get('is_bot') is True, 'wrong_telegram_bot')
        except Exception:
            raise Stop('bot_identity_not_verified') from None
    return values

def modules(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        result = {n[len('tgcloud/'):-3]: z.read(n).decode() for n in z.namelist() if n.startswith('tgcloud/') and n.endswith('.js')}
    require('schema' in result and 'handlers/message' in result, 'native_modules_missing')
    return result

def tg_request(cfg, token, path, body=None):
    return request('https://cloud.telegram.org/' + cfg['appId'] + '/manage' + path, token,
        'GET' if body is None else 'POST', body, envelope=True)

def ycf_version(cfg, token):
    return request(API + 'versions:byTag?' + urllib.parse.urlencode({'functionId': cfg['functionId'], 'tag': '$latest'}), token)

def deploy(root, cfg, sha, folder, data):
    token, current = cloud(cfg)
    # One mutation only. Persist previous state before sending; never auto-resend on a timeout.
    require(not (folder / 'submitted.json').exists(), 'existing_attempt_inspect_and_verify_before_retry')
    values = verify_cloud_runtime(root, cfg, token)
    if cfg['provider'] == 'ycf':
        previous = ycf_version(cfg, token)
        old_data_secret = previous.get('environment', {}).get('BOT_DATA_SECRET')
        require(not old_data_secret or old_data_secret == values.get('BOT_DATA_SECRET'), 'data_secret_changed_requires_migration_plan')
        (folder / 'previous.json').write_text(json.dumps({'versionId': previous['id']}))
        payload = {'functionId': cfg['functionId'], 'runtime': 'nodejs22', 'entrypoint': cfg['entrypoint'],
            'description': 'source:' + sha + ';archive:' + digest(data), 'resources': {'memory': str(cfg.get('memory', 268435456))},
            'executionTimeout': cfg.get('timeout', '25s'), 'serviceAccountId': cfg['serviceAccountId'],
            'environment': cfg.get('environmentVariables', {}) | values, 'secrets': [], 'content': base64.b64encode(data).decode()}
        (folder / 'submitted.json').write_text('{"status":"attempt_started_inspect_cloud_before_retry"}')
        result = request(API + 'versions', token, 'POST', payload)
        require(bool(result.get('id')), 'missing_operation_id_inspect_cloud')
        receipt = {'operationId': result['id'], 'sourceSha': sha, 'archiveSha256': digest(data), 'status': 'submitted_verify_required'}
    else:
        require(current.get('revision') == cfg['expectedRevision'], 'remote_revision_changed')
        previous = {'revision': current['revision'], 'modules': current.get('canonical_modules', {})}
        # Source snapshot contains no credentials; it is private, never part of handoff.
        (folder / 'previous.json').write_text(json.dumps(previous))
        (folder / 'previous.json').chmod(0o600)
        sources = modules(data)
        (folder / 'submitted.json').write_text('{"status":"attempt_started_inspect_cloud_before_retry"}')
        result = tg_request(cfg, token, '/deploy', {'expected_revision': current['revision'], 'manifest': sorted(sources), 'changed_sources': sources})
        require(type(result.get('revision')) is int, 'missing_revision_inspect_cloud')
        receipt = {'revision': result['revision'], 'sourceSha': sha, 'status': 'submitted_verify_required'}
    (folder / 'submitted.json').write_text(json.dumps(receipt))
    return receipt

def verify(cfg, sha, folder, data):
    token, current = cloud(cfg)
    if cfg['provider'] == 'ycf':
        version = ycf_version(cfg, token)
        expected_environment = cfg.get('environmentVariables', {}) | secret_values(cfg)
        require(version.get('status') == 'ACTIVE' and version.get('description') == 'source:' + sha + ';archive:' + digest(data) and
            version.get('runtime') == 'nodejs22' and version.get('serviceAccountId') == cfg['serviceAccountId'] and
            version.get('entrypoint') == cfg['entrypoint'] and version.get('environment', {}) == expected_environment and
            not version.get('secrets'), 'active_version_not_verified')
        return {'verifiedVersion': version['id'], 'sourceSha': sha, 'functionalSmoke': 'requires_separate_real_bot_acceptance'}
    require(current.get('canonical_modules') == modules(data), 'remote_modules_differ')
    webhook = tg_request(cfg, token, '/webhook')
    require(webhook.get('in_sync') is True, 'native_webhook_not_in_sync')
    return {'verifiedRevision': current['revision'], 'sourceSha': sha, 'functionalSmoke': 'requires_separate_real_bot_acceptance'}

def rollback(cfg, folder):
    token, current = cloud(cfg)
    previous = json.loads((folder / 'previous.json').read_text())
    require(not (folder / 'rollback-submitted.json').exists(), 'rollback_attempt_exists_inspect_provider')
    if cfg['provider'] == 'ycf':
        receipt = json.loads((folder / 'submitted.json').read_text())
        require('operationId' in receipt, 'unknown_deploy_inspect_provider_first')
        active = ycf_version(cfg, token)
        require(active.get('description') == 'source:' + receipt['sourceSha'] + ';archive:' + receipt['archiveSha256'], 'remote_changed_since_deploy')
        old = request(API + 'versions/' + previous['versionId'], token)
        require(old.get('functionId') == cfg['functionId'], 'wrong_previous_function')
        payload = {k: old[k] for k in ('runtime', 'entrypoint', 'resources', 'executionTimeout', 'serviceAccountId', 'environment', 'secrets', 'concurrency', 'connectivity', 'logOptions') if k in old}
        payload.update({'functionId': cfg['functionId'], 'versionId': previous['versionId'], 'description': old.get('description', '')})
        (folder / 'rollback-submitted.json').write_text('{"status":"attempt_started"}')
        request(API + 'versions', token, 'POST', payload)
    else:
        receipt = json.loads((folder / 'submitted.json').read_text())
        require(current.get('revision') == receipt.get('revision'), 'remote_changed_since_deploy')
        (folder / 'rollback-submitted.json').write_text('{"status":"attempt_started"}')
        tg_request(cfg, token, '/deploy', {'expected_revision': current['revision'], 'manifest': sorted(previous['modules']), 'changed_sources': previous['modules']})
    return {'rollback': 'submitted_inspect_and_verify_previous_source', 'database': 'unchanged'}

def migrate(root, cfg, folder, data):
    ids = cfg.get('migrationIds', [])
    require(ids and all(isinstance(x, str) for x in ids), 'explicit_reviewed_migration_ids_required')
    require(not (folder / 'migration-submitted.json').exists(), 'migration_attempt_exists_inspect_provider')
    token, _ = cloud(cfg)
    if cfg['provider'] == 'telegram':
        (folder / 'migration-submitted.json').write_text('{"status":"attempt_started"}')
        tg_request(cfg, token, '/migrate', {'schema': modules(data)['schema'], 'apply': ids})
    else:
        require(ids == ['001-records'], 'only_additive_records_migration_supported')
        env = cfg.get('environmentVariables', {})
        database = env.get('YDB_DATABASE', '')
        require(cfg['folderId'] in database.split('/'), 'database_outside_explicit_client_folder')
        require(run(['node', '-p', 'process.versions.node.split(".")[0]'], root) == '22', 'node22_required')
        with tempfile.TemporaryDirectory(prefix='bot-migration-') as tmp:
            target = Path(tmp)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                z.extractall(target)
            run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], target, clean_env())
            require((target / 'lib/database.js').is_file(), 'reviewed_database_tool_missing')
            (folder / 'migration-submitted.json').write_text('{"status":"attempt_started"}')
            migration_env = clean_env() | {k: env[k] for k in ('YDB_ENDPOINT', 'YDB_DATABASE')} | {'IAM_TOKEN': token}
            run(['node', 'lib/database.js', '--execute', '--database', database], target, migration_env)
    return {'migration': 'submitted_verify_schema_and_data_separately', 'automaticRetry': False}

@contextlib.contextmanager
def lock(root, cfg):
    directory = root / '.release-lock'
    try:
        directory.mkdir()
    except FileExistsError:
        raise Stop('another_release_or_stale_lock_inspect_before_removing') from None
    try:
        yield
    finally:
        directory.rmdir()

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=OPS, nargs='?', default='status')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--config', default='')
    args = parser.parse_args(argv)
    root = args.root.resolve()
    try:
        if args.operation == 'status':
            print(json.dumps({'operation': 'status', 'cloudAccess': False,
                'git': 'dirty' if run(['git', 'status', '--porcelain'], root) else 'clean'}))
            return 0
        cfg = load_config(root, args.config)
        if args.operation == 'provision':
            raise Stop('provision_is_separate_owner_step_follow_RUNBOOK_no_resources_created')
        sha = source(root, cfg)
        validate_runtime(root, cfg)
        target = cfg['provider'] + '-' + (cfg['functionId'] if cfg['provider'] == 'ycf' else cfg['appId'])
        folder = root / 'artifacts' / cfg['client'] / cfg['environment'] / target / sha
        if args.operation == 'preflight':
            token, _ = cloud(cfg)
            verify_cloud_runtime(root, cfg, token)
            result = {'preflight': 'passed', 'sourceSha': sha, 'mutations': False}
        else:
            with lock(root, cfg):
                if args.operation == 'build':
                    result = build(root, cfg, sha, folder)
                else:
                    data = artifact(folder, cfg, sha)
                    if args.operation == 'deploy':
                        result = deploy(root, cfg, sha, folder, data)
                    elif args.operation == 'verify':
                        result = verify(cfg, sha, folder, data)
                    elif args.operation == 'rollback':
                        result = rollback(cfg, folder)
                    elif args.operation == 'migrate':
                        result = migrate(root, cfg, folder, data)
                    else:
                        with zipfile.ZipFile(folder / 'handoff.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
                            bundle.writestr('source.zip', data)
                            bundle.writestr('manifest.json', (folder / 'manifest.json').read_bytes())
                            bundle.writestr('deployment-config.json', json.dumps(cfg, indent=2))
                        result = {'handoffSha256': digest((folder / 'handoff.zip').read_bytes()), 'contains': 'source_manifest_nonsecret_config; no credentials or database export'}
        print(json.dumps(result))
        return 0
    except (Stop, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('STOP: ' + (str(error) if isinstance(error, Stop) else type(error).__name__), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
