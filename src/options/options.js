'use strict';

const divToProviderMap = new WeakMap();
const quotas = {};

const el = {
  optionsForm: document.getElementById('options-form'),
  divBackendList: document.getElementById('backend-list'),
  templateAzureBackend: document.getElementById('azure-backend-template'),
  templateGoogleBackend: document.getElementById('google-backend-template'),
  buttonAddAzureProvider: document.getElementById('add-azure-backend'),
  buttonAddGoogleProvider: document.getElementById('add-google-backend'),
  inputTarget: document.getElementById('target'),
  inputCacheSize: document.getElementById('cache-size'),
  inputDomains: document.getElementById('domains'),
  buttonFlushCache: document.getElementById('flush-cache')
};

// Restore the options from local stoage.
browser.storage.local.get({
  target: 'en',
  domains: [],
  cacheSize: 1000,
  providers: [],
  quotas: {}
}).then(results => {
  el.inputTarget.value = results.target;
  el.inputDomains.value = results.domains.join('\n');
  el.inputCacheSize.value = results.cacheSize;
  Object.assign(quotas, results.quotas);
  console.log(quotas);
  if (results.providers.length) {
    el.divBackendList.innerText = '';
    results.providers.forEach(provider => createProvider(provider));
  }
});

// Bind event handlers to the form.
el.buttonAddAzureProvider.addEventListener('click', () => createProvider({
  service: 'azure',
  enabled: true,
  apiKey: '',
  color: 'RoyalBlue',
  warnAfter: 1980000,
  stopAfter: 1995000,
  resetOn: 1,
  quotaKey: `quota-azure-${new Date().getTime()}`
}).scrollIntoView());
el.buttonAddGoogleProvider.addEventListener('click', () => createProvider({
  service: 'google',
  enabled: true,
  apiKey: '',
  color: 'ForestGreen',
  warnAfter: 480000,
  stopAfter: 485000,
  resetOn: 1,
  quotaKey: `quota-google-${new Date().getTime()}`
}).scrollIntoView());
el.optionsForm.addEventListener('submit', saveOptions);
el.buttonFlushCache.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ 
    topic: 'flushCache'
  });

  alert('Flushed the cache.');
});

function createProvider (provider) {
  // Select a template for this provider.
  let templateElement = {
    'azure': el.templateAzureBackend.content,
    'google': el.templateGoogleBackend.content,
  }[provider.service];

  // Lookup quotas for this provider.
  let quota = quotas[provider.quotaKey] || {
    characters: 0
  };  

  let template = document.importNode(templateElement, true);
  let tpl = {
    divProvider: template.firstElementChild,
    inputEnabled: template.querySelector('[name="enabled"]'),
    inputApiKey: template.querySelector('[name="api-key"]'),
    inputColor: template.querySelector('[name="color"]'),
    inputWarnAfter: template.querySelector('[name="warn-after"]'),
    inputStopAfter: template.querySelector('[name="stop-after"]'),
    inputResetOn: template.querySelector('[name="reset-on"]'),
    inputQuotaKey: template.querySelector('[name="quota-key"]'),
    cellQuotaCharacters: template.querySelector('td.quota-characters'),
    buttonMoveUp: template.querySelector('button.move-up'),
    buttonMoveDown: template.querySelector('button.move-down'),
    buttonDelete: template.querySelector('button.delete'),
    buttonCacheReset: template.querySelector('button.cache-reset')
  };
  tpl.inputEnabled.checked = provider.enabled;
  tpl.inputApiKey.value = provider.apiKey;
  tpl.inputColor.value = provider.color || null;
  tpl.inputWarnAfter.value = provider.warnAfter;
  tpl.inputStopAfter.value = provider.stopAfter;
  tpl.inputResetOn.value = provider.resetOn;
  tpl.inputQuotaKey.value = provider.quotaKey;
  tpl.cellQuotaCharacters.innerText = quota.characters;

  // Bind event handlers to the provider form.
  tpl.buttonMoveUp.addEventListener('click', () => moveUpProvider(tpl.divProvider));
  tpl.buttonMoveDown.addEventListener('click', () => moveDownProvider(tpl.divProvider));
  tpl.buttonDelete.addEventListener('click', () => deleteProvider(tpl.divProvider));
  tpl.buttonCacheReset.addEventListener('click', () => quotaResetProvider(tpl, provider.quotaKey));

  el.divBackendList.appendChild(template);
  divToProviderMap.set(tpl.divProvider, () => ({
    service: provider.service,
    enabled: tpl.inputEnabled.checked,
    apiKey: tpl.inputApiKey.value,
    color: tpl.inputColor.value,
    warnAfter: Number(tpl.inputWarnAfter.value),
    stopAfter: Number(tpl.inputStopAfter.value),
    resetOn: Number(tpl.inputResetOn.value),
    quotaKey: tpl.inputQuotaKey.value
  }));

  return tpl.divProvider;
}

function moveUpProvider (element) {
  if (element.previousElementSibling) {
    element.parentNode.insertBefore(element, element.previousElementSibling);
  }
}

function moveDownProvider (element) {
  if (element.nextElementSibling) {
    element.parentNode.insertBefore(element.nextElementSibling, element);
  }
}

function deleteProvider (element) {
  element.parentNode.removeChild(element);
}

async function quotaResetProvider (tpl, quotaKey) {  
  let newQuota = Number.parseInt(prompt('Reset character quota to this amount:', 0));
  if (Number.isFinite(newQuota) && (newQuota >= 0)) {
    let data = await browser.storage.local.get({ quotas: {} });
    data.quotas[quotaKey] = {
      month: new Date().getMonth(),
      characters: newQuota
    };
    await browser.storage.local.set(data);
    tpl.cellQuotaCharacters.innerText = newQuota;
  }
}

// Save the options to local storage.
async function saveOptions (event) {
  event.preventDefault();
  event.stopPropagation();

  if (!el.optionsForm.checkValidity()) {
    return;
  }

  let providers = [].slice.call(el.divBackendList.children)
    .filter(element => element.tagName === 'DIV')
    .map(divProvider => divToProviderMap.get(divProvider)());

  // Delete quotas for any providers that no longer exist.
  let validQuotaKeys = new Set();
  providers.forEach(provider => validQuotaKeys.add(provider.quotaKey));
  let results = await browser.storage.local.get({ quotas: {} });
  Object.assign(quotas, results.quotas);
  Object.keys(quotas).forEach(quotaKey => {
    if (!validQuotaKeys.has(quotaKey)) {
      delete quotas[quotaKey];
    }
  });

  await browser.storage.local.set({
    target: el.inputTarget.value,
    domains: el.inputDomains.value
      .split('\n')
      .map(domain => domain.trim())
      .filter(domain => domain),
    cacheSize: Number(el.inputCacheSize.value),
    providers,
    quotas
  });

  alert('Settings have been saved');
}
