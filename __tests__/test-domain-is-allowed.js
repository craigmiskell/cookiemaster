domainIsAllowed = require ("../config.js").domainIsAllowed

configUnderTest = {
  allowList: [
    ".example.org",
    ".foo.bar.com"
  ]
}

describe('domainIsAllowed', () => {
  test('allows an exact match with no leading dot', () => {
    var result = domainIsAllowed(configUnderTest, "example.org")
    expect(result).toBe(".example.org")
  });
  test('allows a sub-domain', () => {
    var result = domainIsAllowed(configUnderTest, "foo.example.org")
    expect(result).toBe(".example.org")
  });
  test('allows a sub-domain with leading dot', () => {
    var result = domainIsAllowed(configUnderTest, ".foo.example.org")
    expect(result).toBe(".example.org")
  });
  test('rejects a non-allowed domain', () => {
    var result = domainIsAllowed(configUnderTest, "badexample.com")
    expect(result).toBeUndefined()
  });
  test('rejects a parent domain of longer allowal', () => {
    var result = domainIsAllowed(configUnderTest, "bar.com")
    expect(result).toBeUndefined()
  });
  test('rejects a parent domain with leading dot, of longer allowal', () => {
    var result = domainIsAllowed(configUnderTest, ".bar.com")
    expect(result).toBeUndefined()
  });
});
