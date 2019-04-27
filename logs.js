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

let lastUpdatedLogs = new Date(0);
var updating = true;

async function displayLogs() {
  if (!updating) {
    //Paused by the user; do nothing
    return;
  }
  let logs = await browser.runtime.sendMessage({type: MessageTypes.GetLogs});
  let logLevels = Object.keys(LogLevel);

  let logTableBody = document.querySelector("#logsBody");

  //Only change the rows that need it; this takes about 1/3 the time of the naive 'nuke and replace' approach
  // and makes the window much more responsive under high log load.
  let firstLogIndex = logs[0].i;
  let lastLogIndex = logs[logs.length - 1].i;
  
  //The array-index in logs that we want to start inserting from (in reverse order)
  //Assume we want to add all of the logs, unless we determine otherwise later.
  let startIndex = logs.length-1; 

  if (logTableBody.children.length > 0) {
    //There are existing logs displayed; figure out which ones we need to remove
    let firstRowIndex = logTableBody.firstChild.dataset.i;
    let lastRowIndex = logTableBody.lastChild.dataset.i;
  
    if (firstRowIndex < lastLogIndex) {
      //All rows displayed in the table are older than the current logs; delete the current table entirely
      // as this should be quicker.
      logTableBody.innerHTML=''; //Clear out anything previous
    } else {
      //Delete the rows in the table that are older than the last log we have
      while (logTableBody.lastChild.dataset.i < lastLogIndex) {
        logTableBody.removeChild(logTableBody.lastChild);
      }
      //Determine the index of the first new log in logs
      //NB: will be -1 if there are no new logs; the while-condition will deal with this
      startIndex = firstLogIndex - firstRowIndex - 1; 
      //But first use -1 as an indicator that there are no new logs, so we should 
      // refresh the first row in case the count has changed
      if (startIndex == -1) {
        let row = logTableBody.firstChild;
        let tsCell = row.children[0];
        let logCell = row.children[2];
        let firstLog = logs[0];
        tsCell.innerText = firstLog.timestamp.toLocaleString();
        logCell.innerHTML= htmlifyLog(firstLog);
      }
   }
  }
  while (startIndex >= 0) {
    let log = logs[startIndex--];
    let newRow = logTableBody.insertRow(0);
    newRow.dataset.i = log.i;
    let timestampCell = newRow.insertCell(0);
    timestampCell.innerText = log.timestamp.toLocaleString();
    timestampCell.classList.add('timestamp');

    let levelCell = newRow.insertCell(1);
    levelCell.innerText = logLevels[log.level];

    let logCell = newRow.insertCell(2);
    logCell.innerHTML= htmlifyLog(log);
  }
}

function htmlifyLog(log) {
  let str = log.log
  if (str == undefined) {
    str = "";
  }
  if (typeof(log.log) == "object") {
    str = JSON.stringify(log.log, undefined, 1);
  }
  str = str.replace("\n", "<br>");
  if (log.count > 1) {
    str = str + " (x "+log.count+")" 
  }
  return str;
}

async function setLogLevel(e) {
  let select = e.target;
  await browser.runtime.sendMessage({type: MessageTypes.SetLogLevel, level: select.value});
}
async function populateLogLevelSelect() {
  let currentLogLevel = await browser.runtime.sendMessage({type: MessageTypes.GetLogLevel });
  let select = document.getElementById('logLevel');
  Object.keys(LogLevel).forEach((value, index) => {
    let option = document.createElement('option');
    option.value = index;
    option.innerText = value;
    if (currentLogLevel == index) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.addEventListener("change", setLogLevel);
}

function pause(e) {
  updating = false;
  e.target.innerText = "Un-pause";
  e.target.removeEventListener("click", pause);
  e.target.addEventListener("click", unpause);
}

function unpause(e) {
  updating = true;
  e.target.innerText = "Pause";
  e.target.removeEventListener("click", unpause);
  e.target.addEventListener("click", pause);
}

async function contentLoaded() {
  populateLogLevelSelect();
  document.getElementById("pause").addEventListener("click", pause)
  await displayLogs();
}

function handleMessage(message, sender, sendMessage) {
  switch(message.type) {
    case MessageTypes.MessageLogged:
      displayLogs();
      break;
  }
}

document.addEventListener('DOMContentLoaded', contentLoaded);
browser.runtime.onMessage.addListener(handleMessage);
