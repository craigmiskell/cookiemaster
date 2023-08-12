CookieDateParser = require ("../cookie-date.js").CookieDateParser

describe('CookieDateParse', () => {
  test('works on a trivial case', () => {
    var result = new CookieDateParser().parseDate("Wed 21 Oct 2015 23:28:01 GMT");
    expect(result.valueOf()).toEqual(new Date(2015, 9, 21, 23, 28, 1).valueOf());
  });
  test('works in January', () => {
    var result = new CookieDateParser().parseDate("Wed 21 Jan 2015 23:28:01 GMT");
    expect(result.valueOf()).toEqual(new Date(2015, 0, 21, 23, 28, 1).valueOf());
  });
  test('works in on the first of the month', () => {
    var result = new CookieDateParser().parseDate("Wed 01 Feb 2015 23:28:01 GMT");
    expect(result.valueOf()).toEqual(new Date(2015, 1, 1, 23, 28, 1).valueOf());
  });
  test('works when date is 2 digit and after 70', () => {
    var result = new CookieDateParser().parseDate("21 Oct 71 23:28:01");
    expect(result.valueOf()).toEqual(new Date(1971, 9, 21, 23, 28, 1).valueOf());
  });
  test('works when date is 2 digit and before 70', () => {
    var result = new CookieDateParser().parseDate("21 Oct 69 23:28:01");
    expect(result.valueOf()).toEqual(new Date(2069, 9, 21, 23, 28, 1).valueOf());
  });
  test('works when date is 4 digit and leading zeros', () => {
    var result = new CookieDateParser().parseDate("21 Oct 0004 23:28:01");
    expect(result.valueOf()).toEqual(new Date(2004, 9, 21, 23, 28, 1).valueOf());
  });
  test('works when the time components are all single digit', () => {
    var result = new CookieDateParser().parseDate("31 Aug 2020 1:2:3");
    expect(result.valueOf()).toEqual(new Date(2020, 7, 31, 1, 2, 3).valueOf());
  });
  test('works when the delimiter in the day is a hyphen', () => {
    var result = new CookieDateParser().parseDate("Sat, 21-Mar-2020 07:12:33");
    expect(result.valueOf()).toEqual(new Date(2020, 2, 21, 7, 12, 33).valueOf());
  });

  // Bad formats
  test('does not parse when the year is 5 digits', () => {
    var result = new CookieDateParser().parseDate("31 Aug 20202 1:2:3");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the month is not valid', () => {
    var result = new CookieDateParser().parseDate("31 Atg 2020 10:20:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the day is too big', () => {
    var result = new CookieDateParser().parseDate("32 Aug 2020 10:20:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the day is zero', () => {
    var result = new CookieDateParser().parseDate("00 Aug 2020 10:20:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the year is the smallest valid year', () => {
    var result = new CookieDateParser().parseDate("01 Aug 1601 10:20:30");
    expect(result.valueOf()).toEqual(new Date(1601, 7, 1, 10, 20, 30).valueOf());
  });
  test('does not parse when the year is too small', () => {
    var result = new CookieDateParser().parseDate("01 Aug 1600 10:20:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the hour is too big', () => {
    var result = new CookieDateParser().parseDate("01 Jan 2020 24:20:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the minute is too big', () => {
    var result = new CookieDateParser().parseDate("01 Jan 2020 02:61:30");
    expect(result).toEqual(undefined);
  });
  test('does not parse when the second is too big', () => {
    var result = new CookieDateParser().parseDate("01 Jan 2020 02:30:78");
    expect(result).toEqual(undefined);
  });

  // Weird cases that should parse, even though we don't ever expect them
  test('works on weird case 1', () => {
    var result = new CookieDateParser().parseDate("03:17:21 01 Jan 2020");
    expect(result.valueOf()).toEqual(new Date(2020, 0, 1, 3, 17, 21).valueOf());
  });
  test('works on weird case 2', () => {
    var result = new CookieDateParser().parseDate(";03:17:21;01;Jan;2020;");
    expect(result.valueOf()).toEqual(new Date(2020, 0, 1, 3, 17, 21).valueOf());
  });
  test('works on weird case 3', () => {
    var result = new CookieDateParser().parseDate("Dec 01 04:29:00 2019");
    expect(result.valueOf()).toEqual(new Date(2019, 11, 1, 4, 29, 0).valueOf());
  });
  test('works on weird case 4', () => {
    var result = new CookieDateParser().parseDate("2017 6:59:01 Feb 7");
    expect(result.valueOf()).toEqual(new Date(2017, 1, 7, 6, 59, 1).valueOf());
  });
});
