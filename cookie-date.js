// Why not use a nice library, like https://github.com/salesforce/tough-cookie?
// The firefox 3rd party library usage policy (https://developer.mozilla.org/en-US/Add-ons/Third_Party_Library_Usage )
// requires that the entire 3rd party library be included.  I had previously
// extracted the 1 required (and 2 supporting) functions (parseDate and friends)
// into a nice 7K file, which I figured was a derivative work.  This is still
// apparently not acceptable, and although the current release (1.0.9) was
// allowed to remain, future versions would need to include the full library
// It's an NPM module upstream, so the only way to do that is to use npm and
// something like webpack.  I tried this, and my 12K background.js and 7K
// tough-cookie.js extract turned into nearly 400 modules and 267K generated
// JS.  This is patently ridiculous, and I'm will not accept it.
// Note that is *not* a licensing issue; extracting 3 functions from tough-cookie
// is quite acceptable per the license.  It is a FF review issue only.
// So I have re-implemented parseDate in a clean-room fashion per the RFC. FML.
// (Also, this could well be a reason why so many websites are such performance
// hogs, as, in the interest of developer time, half of NPM is included as
// dependencies of one handy (but not critical) input.  Here endeth the rant)

// Implements parsing of dates per https://tools.ietf.org/html/rfc6265#section-5.1.1
class CookieDateParser {
  constructor() {
    this.createDelimiterCodes();
    this.monthShortStrings = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep",
                    "oct", "nov", "dec"];
  }

  createDelimiterCodes() {
    this.dateDelimiterCodes = new Set([0x09]);
    this.addDelimiterRange(this.dateDelimiterCodes, 0x20, 0x2F);
    this.addDelimiterRange(this.dateDelimiterCodes, 0x3B, 0x40);
    this.addDelimiterRange(this.dateDelimiterCodes, 0x5B, 0x60);
    this.addDelimiterRange(this.dateDelimiterCodes, 0x7B, 0x7E);
  }

  addDelimiterRange(codes, low, high) {
    for(var i=low; i <= high; i++)  {
      codes.add(i);
    }
  }

  isDigit(charCode) {
    return ((charCode >= 48) && (charCode <= 57))
  }

  isTimeField(part, allowTrailing = false) {
     if(part.length == 0) {
       return false;
     }
     if(!this.isDigit(part.charCodeAt(0))) {
       return false;
     }
     if(part.length == 2) {
       if(!allowTrailing && !this.isDigit(part.charCodeAt(1))) {
         return false;
       }
     }
     if(part.length > 2) {
       if(!allowTrailing || this.isDigit(part.charCodeAt(2))) {
         // A third char *must not be a digit*; and only
         // some items allow such trailing chars
         return false;
       }
     }
     return true;
  }

  // time            = hms-time ( non-digit *OCTET )
  // hms-time        = time-field ":" time-field ":" time-field
  // time-field      = 1*2DIGIT
  parseCookieTime(dateToken) {
    var parts = dateToken.split(":");
    if(parts.length >= 3) {
      // Must be *at least* 3 parts; more is possible, but can be ignored
      if(this.isTimeField(parts[0]) && this.isTimeField(parts[1]) && this.isTimeField(parts[2], true)) {
        return [true, parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2])];
      }
    }
    return [false, undefined, undefined, undefined];
  }

  // day-of-month    = 1*2DIGIT ( non-digit *OCTET )
  parseCookieDayOfMonth(dateToken) {
    if(this.isTimeField(dateToken, true)) {
      return parseInt(dateToken);
    }
    return undefined;
  }

  parseCookieMonth(dateToken) {
    if(dateToken.length < 3) {
      return undefined;
    }
    var lowerDateToken = dateToken.substring(0,3).toLowerCase();
    var index = this.monthShortStrings.indexOf(lowerDateToken);
    if(index == -1) {
      return undefined;
    }
    return index;
  }

  // year            = 2*4DIGIT ( non-digit *OCTET )
  parseCookieYear(dateToken) {
    if(dateToken.length < 2) {
      return undefined;
    }
    if(dateToken.length > 4 && this.isDigit(dateToken.charCodeAt(4))) {
      // Too long (5 or more digits)
      return undefined;
    }
    if(this.isDigit(dateToken.charCodeAt(0)) && this.isDigit(dateToken.charCodeAt(1))) {
      // At least 2 digits, and *not more than 4* (but could be less);
      // parseInt is going to do the magic we require, ignoring any
      // trailing junk (at or beyond 3 digits)
      return parseInt(dateToken);
    }
    return undefined;
  }

  parseDate(dateString) {
    var year, month, day_of_month, hour, minute, second;
    var found_time = false;
    var index = 0;
    var dateTokenChars = [];

    while(index < dateString.length) {
      var charCode = dateString.charCodeAt(index);
      var char = dateString.charAt(index);
      index++;

      var isDelim = this.dateDelimiterCodes.has(charCode);
      if(!isDelim) {
        dateTokenChars.push(char);
      }

      if(isDelim || index >= dateString.length) {
        if (dateTokenChars.length > 0) {
          // date token has finished; process it
          var dateToken = dateTokenChars.join("");
          dateTokenChars = []; // Clear it out for next loop
          if(!found_time) {
            [found_time, hour, minute,second] = this.parseCookieTime(dateToken);
            if(found_time) {
              continue;
            }
          }
          if(day_of_month == undefined) {
            if(day_of_month = this.parseCookieDayOfMonth(dateToken)) {
              continue;
            }
          }
          if(month == undefined) {
            month = this.parseCookieMonth(dateToken);
            if (month != undefined) {
              continue;
            }
          }
          if(year == undefined) {
            year = this.parseCookieYear(dateToken);
            if (year != undefined) {
              if((year >= 70) && (year <= 99)) {
                year += 1900;
              } else if ((year >= 0) && (year <= 69)) {
                year += 2000;
              }
            }
          }
        }
        continue;
      }
    }
    if(!found_time || (day_of_month == undefined) || (month == undefined) || (year == undefined)) {
      return undefined;
    }
    if(day_of_month < 1 ||
       day_of_month > 31 ||
       year < 1601 ||
       hour > 23 ||
       minute > 59 ||
       second > 59
    ) {
      return undefined
    }
    return new Date(year, month, day_of_month, hour, minute, second);
  }
}
