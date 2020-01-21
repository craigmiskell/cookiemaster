describe('CookieDateParse', function() {
  it('works on a trivial case', function() {
    var result = new CookieDateParser().parseDate("Wed 21 Oct 2015 23:28:01 GMT");
    expect(result.valueOf()).to.equal(new Date(2015, 9, 21, 23, 28, 1).valueOf());
  });
  it('works in January', function() {
    var result = new CookieDateParser().parseDate("Wed 21 Jan 2015 23:28:01 GMT");
    expect(result.valueOf()).to.equal(new Date(2015, 0, 21, 23, 28, 1).valueOf());
  });
  it('works in on the first of the month', function() {
    var result = new CookieDateParser().parseDate("Wed 01 Feb 2015 23:28:01 GMT");
    expect(result.valueOf()).to.equal(new Date(2015, 1, 1, 23, 28, 1).valueOf());
  });
  it('works when date is 2 digit and after 70', function() {
    var result = new CookieDateParser().parseDate("21 Oct 71 23:28:01");
    expect(result.valueOf()).to.equal(new Date(1971, 9, 21, 23, 28, 1).valueOf());
  });
  it('works when date is 2 digit and before 70', function() {
    var result = new CookieDateParser().parseDate("21 Oct 69 23:28:01");
    expect(result.valueOf()).to.equal(new Date(2069, 9, 21, 23, 28, 1).valueOf());
  });
  it('works when date is 4 digit and leading zeros', function() {
    var result = new CookieDateParser().parseDate("21 Oct 0004 23:28:01");
    expect(result.valueOf()).to.equal(new Date(2004, 9, 21, 23, 28, 1).valueOf());
  });
  it('works when the time components are all single digit', function() {
    var result = new CookieDateParser().parseDate("31 Aug 2020 1:2:3");
    expect(result.valueOf()).to.equal(new Date(2020, 7, 31, 1, 2, 3).valueOf());
  });
  it('works when the delimiter in the day is a hyphen', function() {
    var result = new CookieDateParser().parseDate("Sat, 21-Mar-2020 07:12:33");
    expect(result.valueOf()).to.equal(new Date(2020, 2, 21, 7, 12, 33).valueOf());
  });

  // Bad formats
  it('does not parse when the year is 5 digits', function() {
    var result = new CookieDateParser().parseDate("31 Aug 20202 1:2:3");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the month is not valid', function() {
    var result = new CookieDateParser().parseDate("31 Atg 2020 10:20:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the day is too big', function() {
    var result = new CookieDateParser().parseDate("32 Aug 2020 10:20:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the day is zero', function() {
    var result = new CookieDateParser().parseDate("00 Aug 2020 10:20:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the year is the smallest valid year', function() {
    var result = new CookieDateParser().parseDate("01 Aug 1601 10:20:30");
    expect(result.valueOf()).to.equal(new Date(1601, 7, 1, 10, 20, 30).valueOf());
  });
  it('does not parse when the year is too small', function() {
    var result = new CookieDateParser().parseDate("01 Aug 1600 10:20:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the hour is too big', function() {
    var result = new CookieDateParser().parseDate("01 Jan 2020 24:20:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the minute is too big', function() {
    var result = new CookieDateParser().parseDate("01 Jan 2020 02:61:30");
    expect(result).to.equal(undefined);
  });
  it('does not parse when the second is too big', function() {
    var result = new CookieDateParser().parseDate("01 Jan 2020 02:30:78");
    expect(result).to.equal(undefined);
  });

  // Weird cases that should parse, even though we don't ever expect them
  it('works on weird case 1', function() {
    var result = new CookieDateParser().parseDate("03:17:21 01 Jan 2020");
    expect(result.valueOf()).to.equal(new Date(2020, 0, 1, 3, 17, 21).valueOf());
  });
  it('works on weird case 2', function() {
    var result = new CookieDateParser().parseDate(";03:17:21;01;Jan;2020;");
    expect(result.valueOf()).to.equal(new Date(2020, 0, 1, 3, 17, 21).valueOf());
  });
  it('works on weird case 3', function() {
    var result = new CookieDateParser().parseDate("Dec 01 04:29:00 2019");
    expect(result.valueOf()).to.equal(new Date(2019, 11, 1, 4, 29, 00).valueOf());
  });
  it('works on weird case 4', function() {
    var result = new CookieDateParser().parseDate("2017 6:59:01 Feb 7");
    expect(result.valueOf()).to.equal(new Date(2017, 1, 7, 6, 59, 1).valueOf());
  });
});
