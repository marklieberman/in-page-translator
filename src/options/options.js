'use strict';

const el = {
  optionsForm: document.getElementById('options-form'),
  inputApiKey: document.getElementById('api-key'),
  inputTarget: document.getElementById('target'),
  inputCacheSize: document.getElementById('cache-size'),
  inputDomains: document.getElementById('domains'),
  inputWarnAfter: document.getElementById('warn-after'),
  inputDisableAfter: document.getElementById('disable-after'),
  buttonClearCache: document.getElementById('clear-cache'),
  buttonResetCharacters: document.getElementById('reset-characters'),
  cellStatisticsCharacters: document.getElementById('statistics-characters')
};

// Restore the options from local stoage.
browser.storage.local.get({
  apiKey: '',
  target: 'en',
  domains: [],
  cacheSize: 1000,
  warnAfter: 400000,
  disableAfter: 480000,
  statistics: {
    characters: 0
  }
}).then(results => {
  // Setup
  el.inputApiKey.value = results.apiKey;
  el.inputTarget.value = results.target;
  el.inputDomains.value = results.domains.join('\n');
  el.inputCacheSize.value = results.cacheSize;
  el.inputWarnAfter.value = results.warnAfter;
  el.inputDisableAfter.value = results.disableAfter;

  // Statistics
  el.cellStatisticsCharacters.innerText = results.statistics.characters;
});

// Bind event handlers to the form.
el.optionsForm.addEventListener('submit', saveOptions);
el.buttonClearCache.addEventListener('click', clearCache);
el.buttonResetCharacters.addEventListener('click', resetCharacters);

// Clear the cache.
async function clearCache () {
  await browser.storage.local.set({
    cacheData: []
  });

  alert('The cache has been cleared.');
}

async function resetCharacters () {
  let input = Number.parseInt(prompt('Set new value for translated characters?', '0'));
  if (Number.isFinite(input)) {
    await browser.storage.local.set({
      statistics: {
        month: new Date().getMonth(),
        characters: input
      }
    });

    el.cellStatisticsCharacters.innerText = input;
  }
}

// Save the options to local storage.
function saveOptions (event) {
  if (el.optionsForm.checkValidity() === false) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  return browser.storage.local.set({
    apiKey: el.inputApiKey.value,
    target: el.inputTarget.value,
    domains: el.inputDomains.value
      .split('\n')
      .map(domain => domain.trim())
      .filter(domain => domain),
    cacheSize: Number(el.inputCacheSize.value),
    warnAfter: Number(el.inputWarnAfter.value),
    disableAfter: Number(el.inputDisableAfter.value),
  });
}
