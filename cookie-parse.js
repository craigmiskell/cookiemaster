/*
 * Derived (extract + modify) from https://github.com/jkohrman/cookie-parse.
 * Original Copyright notice follows:
 * cookie
 * Copyright(c) 2012-2014 Roman Shtylman
 * Copyright(c) 2015 Douglas Christopher Wilson
 * Copyright(c) 2016 Jeff Kohrman
 * MIT Licensed
 */
var decode = decodeURIComponent;
var encode = encodeURIComponent;
var pairSplitRegExp = /; */;

function cookieparse(str, options) {
  if (typeof str !== 'string') {
    throw new TypeError('argument str must be a string');
  }

  var obj = {}
  var opt = options || {};
  var pairs = str.split(pairSplitRegExp);
  var dec = opt.decode || decode;

  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i];
    var eq_idx = pair.indexOf('=');

    // set true for things that don't look like key=value
    var key;
    var val;
    if (eq_idx < 0) {
      key = pair.trim();
      val = 'true';
    } else {
      key = pair.substr(0, eq_idx).trim()
      val = pair.substr(++eq_idx, pair.length).trim();
    };

    // quoted values
    if ('"' == val[0]) {
      val = val.slice(1, -1);
    }

    if(i==0) {
      //First pair is the cookie name + value, which need to be dealt with separately, and put into
      // keys 'name' and 'value' respectively.  The list of other attributes is explicit in the RFC
      // (https://tools.ietf.org/html/rfc6265#section-4.1.1) so there is no conflict
      // The original behaviour of this method was to use the cookie name as the key
      // which ran the risk of conflicts with the known Attribute names from the RFC
      obj['name'] = key;
      obj['value'] = val; 
    } else {
      //An attribute.  All attribute names are case-insensitive, so lower-case them here to make life easier for everyone
      key = key.toLowerCase();
      if (undefined == obj[key]) {
        obj[key] = tryDecode(val, dec);
      }
    }
  }

  return obj;
}
/**
 * Try decoding a string using a decoding function.
 *
 * @param {string} str
 * @param {function} decode
 * @private
 */

function tryDecode(str, decode) {
  try {
    return decode(str);
  } catch (e) {
    return str;
  }
}
