// For child-process smoke tests: an accidental fetch must fail the child.
global.fetch = () => { throw new Error('network_forbidden_in_offline_test'); };
