/*
  Copyright 2017 Craig Miskell

  This file is part of CookieMaster, a Firefox Web Extension
  CookieMaster is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  CookieMaster is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
  Instead of logging to console.log, use the log function in this class.
  Keeps a configurable number of log lines with any context we might choose
  and let's a useful UI display them
*/

var LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
}

//Minimum time (in ms) between sending notifications about new logs
var notificationInterval = 250;

//Increments by 1 every log message, added to the log message.
// At 1G messages per second, will last 24 days before hitting
// max safe int (2^53-1), at 1M/s (still utterly absurd), 17 years.
// Not gonna worry about this ever rolling over/maxing out
var counter = 0;

// TODO: Can we make this a singleton?  There needs to be only one
class Logger {
  constructor(limit = 1000, level = LogLevel.INFO) {
    this._limit = limit;
    this._level = level;
    this.notificationTimestamp = 0;
    this.notificationTimer = undefined;
    this.clearLogs();
    browser.runtime.onMessage.addListener(this.handleMessage.bind(this));
  }

  set limit(value) {
    this._limit = value;
  }
  get limit() {
    return this._limit;
  }

  set level(value) {
    this._level = value;
  }
  get level() {
    return this._level;
  }

  error(entry, requestId) {
    this.log(LogLevel.ERROR, entry, requestId);
  }
  warn(entry, requestId) {
    this.log(LogLevel.WARN, entry, requestId);
  }
  info(entry, requestId) {
    this.log(LogLevel.INFO, entry, requestId);
  }
  debug(entry, requestId) {
    this.log(LogLevel.DEBUG, entry, requestId);
  }
  trace(entry, requestId) {
    this.log(LogLevel.TRACE, entry, requestId);
  }

  log(level, entry, requestId) {
    if(level > this._level) {
      return; //Log is higher level of detail than we're asking to record.  Ignore it
    }
    let logline = entry;
    if (entry instanceof Error) {
      logline = entry.name + " Exception: "+entry.message + "\n"+entry.stack;
    }
    if (requestId) {
      logline = requestId + ": "+logline;
    }
    if((this.logs.length > 0) && (logline == this.logs[0].log)) {
      this.logs[0].count++;
    } else {
      this.logs.unshift({timestamp: new Date(),  log: logline, level: level, i: counter++, count: 1});
    }
    if (this.logs.length > this._limit) {
      this.logs.pop();
    }
    if(this.notificationTimer == undefined) {
      if (Date.now() < (this.notificationTimestamp + notificationInterval)) {
        //No timer, and it's too soon since the last time; create a timer to send a message a bit later
        this.notificationTimer = setTimeout(() => {
          this.notificationTimestamp = Date.now();
          browser.runtime.sendMessage({type: MessageTypes.MessageLogged}).then(m => {}, e => {});
          this.notificationTimer = undefined;
        }, notificationInterval);
      } else {
        //Been a while since we last sent a message, and there's no timer; send one
        this.notificationTimestamp = Date.now();
        browser.runtime.sendMessage({type: MessageTypes.MessageLogged}).then(m => {}, e => {});
      }
    }
  }

  //Return the 'count' most recent entries, or all of them if there are less than 'count'
  getEntries(count = 1000) {
    return this.logs.slice(0, count);
  }

  clearLogs() {
    this.logs = new Array();
  }

  //For logging from things not in the 'background' scope/page
  handleMessage(message, sender, sendResponse) {
    switch(message.type) {
      case MessageTypes.LogMessage:
        this.log(message.level, message.entry, message.requestId);
        return false; //No response coming
        break;
      case MessageTypes.GetLogs:
        let count = message.hasOwnProperty("count") ? message.count : undefined;
        sendResponse(this.getEntries(count));
        break;
    }
  }
}

// Implements the log-generating interface of Logger, by sending a message
// to the real Logger instance
class SendMessageLogger {
  constructor() {
  }

  error(entry, requestId) {
    this.log(LogLevel.ERROR, entry, requestId);
  }
  warn(entry, requestId) {
    this.log(LogLevel.WARN, entry, requestId);
  }
  info(entry, requestId) {
    this.log(LogLevel.INFO, entry, requestId);
  }
  debug(entry, requestId) {
    this.log(LogLevel.DEBUG, entry, requestId);
  }
  trace(entry, requestId) {
    this.log(LogLevel.TRACE, entry, requestId);
  }

  log(level, entry, requestId) {
    browser.runtime.sendMessage({
      type: MessageTypes.LogMessage,
      level: level,
      entry: entry,
      requestId: requestId
    });
  }
}

//Use from places that may need to SendMessage to do logging (e.g. config.js)
//  Uses the presence/absence of the 'logger' global var;
// present => direct
// absent  => SendMessage
function contextSafeLogger() {
  if(typeof logger === 'undefined') {
    return new SendMessageLogger();
  } else {
    return new Logger();
  }
}
