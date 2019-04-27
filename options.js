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

async function saveOptions() {
  var newConfig = new Config({});
  var allowListTableBody = document.querySelector("#allowListTableBody");
  for (let row of allowListTableBody.rows) {
    var domainCell = row.cells[0];
    var allowTypeCell = row.cells[1];
    newConfig.setDomainAllow(domainCell.dataset.value, allowTypeCell.dataset.value);
  }

  newConfig.thirdParty = document.querySelector("#thirdParty").value;
  newConfig.ignoreSettingsWarning = document.querySelector("#ignoreSettingsWarning").checked;
  newConfig.save();

  await browser.runtime.sendMessage({type: MessageTypes.ConfigChanged});
}

function addDomainToDisplayList(domain, allowType, setup = false) {
  var allowListTableBody = document.querySelector("#allowListTableBody");
  var index = 0;
  for(let row of allowListTableBody.rows) {
    var domainCell = row.cells[0];
    if (domainCell.dataset.value > domain) {
      break;
    }
    index++;
  }
  var newRow = allowListTableBody.insertRow(index);

  //The use of 'dataset' is possibly overkill here, but it avoids
  // any potential for unexpected behaviour with interpretation
  // of the value as it round-trips through the display/DOM
  var domainCell = newRow.insertCell(0);
  domainCell.innerText = domain;
  domainCell.dataset.value = domain;
  domainCell.style.width = "70%";

  var allowTypeCell = newRow.insertCell(1);
  allowTypeCell.innerText = allowType;
  allowTypeCell.dataset.value = allowType;
  allowTypeCell.style.width = "30%";

  var deleteCell = newRow.insertCell(2);
  //Don't set the width; just let it sort of fill in
  var deleteLink = document.createElement('a');
  deleteLink.classList.add('glyphicon', 'glyphicon-remove', 'delete' );
  deleteLink.addEventListener('click', function(e) {
    var rows = allowListTableBody.rows;
    for (let i = 0; i < rows.length; i++) {
      if(rows[i].cells[0].dataset.value == domain) {
        allowListTableBody.deleteRow(i);
      }
    }
    saveOptions();
  });
  deleteCell.appendChild(deleteLink);

  //Setup flag set true in displayOptions, so we don't scroll when doing initial data load
  if(!setup) {
    //False => align to bottom, i.e. scroll only far enough to show the new item
    newRow.scrollIntoView(false);
  }
}

function displayOptions() {
  Config.get().then((config) => {
    document.querySelector("#thirdParty").value = config.thirdParty;
    for (let domain of config.allowList.keys()) {
      addDomainToDisplayList(domain, config.allowList.get(domain).allowType, true);
    }
    document.querySelector("#ignoreSettingsWarning").checked = config.ignoreSettingsWarning;
  });
}

function addSite(e) {
  var allowListTableBody = document.querySelector("#allowListTableBody");
  var formData = new FormData(document.querySelector('#allowListForm'))
  var domain = formData.get('newSite');
  var allowType = formData.get('allowType');

  if(domain && (domain != "")) {
   for(let row of allowListTableBody.rows) {
      var domainCell = row.cells[0];
      if(domainCell.dataset.value == domain) {
        var allowTypeCell = row.cells[1];
        if(allowTypeCell.dataset.value != allowType) {
          allowTypeCell.dataset.value = allowType;
          allowTypeCell.innerText = allowType;
          saveOptions();
        }
        return;
      }
    }
    addDomainToDisplayList(domain, formData.get('allowType'));
    document.querySelector("#newSite").value = "";
    saveOptions();
  }
}

async function contentLoaded() {
  displayOptions();
  document.querySelector("#thirdParty").addEventListener("change", saveOptions);
  document.querySelector("#ignoreSettingsWarning").addEventListener("change", saveOptions);
  document.querySelector("#resetSettingsForm").addEventListener("submit", resetSettings);
  var testLink = document.querySelector("#testConfig");
  if(testLink) {
    testLink.addEventListener("click", testConfig);
  }

  document.querySelector("#addSite").addEventListener("click", addSite);
  document.getElementById('openLogs').href = browser.runtime.getURL("logs.html");
  document.getElementById('helplink').href = browser.runtime.getURL("help.html");
}

async function resetSettings() {
  logger.log("Clearing all settings");
  await browser.storage.local.clear();
  await Config.resetToFactorySettings();
}

function handleMessage(message, sender, sendMessage) {
  switch(message.type) {
    case MessageTypes.MessageLogged:
      displayLogs();
      break;
  }
}

//A test harness, until I can get around to figuring out unit test infrastructure
function expectTrue(value, message) {
  expect(value, true, message);
}
function expectFalse(value, message) {
  expect(value, false, message);
}
function expect(value, expected, message) {
  if(value != expected) {
    console.error("Failed:" + message);
  } else {
    console.log("Passed: " + message);
  }
}
async function testConfig() {
  //First test is just arbitrary data; if this fails, all is lost
  console.log("***************************************************************************");
  console.log("Test with arbitrary data that should work");
  var config = new Config({
    allowList: ['www.stroppykitten.com', 'www.slashdot.org'],
    thirdParty: ThirdPartyOptions.AllowAll,
  });
  expectTrue((config.allowList instanceof Map), "config.allowList should be a Map");
  //TODO: update this to expect a structure (domain + allow type), when Config returns it
  expect(config.domainIsAllowed("www.stroppykitten.com"), {domain: "www.stroppykitten.com", settings: new DomainSettings(AllowTypes.Persistent)}, "www.stroppykitten.com should be allowed");

  console.log("***************************************************************************");
  console.log("Test by saving array format to local storage, then using the factory method");
  //This test *saves* version 1 config (allowList is an array), then creates a new config object
  // and ensures it converts to a map and works as expected.
  await browser.storage.local.clear();
  await browser.storage.local.set({
    allowList: ['www.stroppykitten.com', 'www.slashdot.org'],
    thirdParty: ThirdPartyOptions.AllowAll,
  });

  var results = await browser.storage.local.get();
  expectTrue(Array.isArray(results.allowList), "allowList from storage should be an array");

  var config2 = await Config.get();
  expectTrue((config2.allowList instanceof Map), "config2.allowList should be a Map");
  //TODO: update this to expect a structure (domain + allow type), when Config returns it
  expect(config2.domainIsAllowed("www.stroppykitten.com"), {domain: "www.stroppykitten.com", settings: new DomainSettings(AllowTypes.Persistent)}, "www.stroppykitten.com should be allowed");

  console.log("***************************************************************************");
  console.log("test a fresh load of allowList still has an array; hasn't been saved yet");
  var results2 = await browser.storage.local.get();
  expectTrue(Array.isArray(results2.allowList), "allowList from storage should be an array");

  console.log("***************************************************************************");
  await config2.save();
  var results3 = await browser.storage.local.get("allowList");
  expectTrue((results3.allowList instanceof Map), "results3.allowList should be a Map");
}

document.addEventListener('DOMContentLoaded', contentLoaded);
browser.runtime.onMessage.addListener(handleMessage);
