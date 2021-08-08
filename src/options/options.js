'use strict';

const cachePrefix = 'cache-';
const defaultCacheName = `${cachePrefix}default`;
const divToOverrideMap = new WeakMap();
const divToProviderMap = new WeakMap();
const quotas = {};

const el = {
  optionsForm: document.getElementById('options-form'),
  inputTarget: document.getElementById('target'),
  inputCacheSize: document.getElementById('cache-size'),
  buttonAddDomain: document.getElementById('add-domain'),
  divOverridesList: document.getElementById('overrides-list'),
  templateDomain: document.getElementById('override-template'),
  buttonAddAzureProvider: document.getElementById('add-azure-backend'),
  buttonAddGoogleProvider: document.getElementById('add-google-backend'),
  divProvidersList: document.getElementById('providers-list'),
  templateAzureBackend: document.getElementById('azure-backend-template'),
  templateGoogleBackend: document.getElementById('google-backend-template'),  
  buttonFlushCache: document.getElementById('flush-cache')
};

// Restore the options from local stoage.
browser.storage.local.get({
  target: 'en',
  cacheSize: 1000,
  overrides: [],
  providers: [],
  quotas: {}
}).then(results => {
  el.inputTarget.value = results.target;
  el.inputCacheSize.value = results.cacheSize;
  Object.assign(quotas, results.quotas);  
  if (results.overrides.length) {
    results.overrides.forEach(override => createOverride(override));
  }
  if (results.providers.length) {
    results.providers.forEach(provider => createProvider(provider));
  }
});

// Bind event handlers to the form.
el.buttonAddDomain.addEventListener('click', () => createOverride({
  matchDomain: null,
  matchRegex: false,
  dedicatedCache: false,
  dedicatedCacheName: `${cachePrefix}-${new Date().getTime()}`,
  dedicatedCacheSize: 500,
  cacheOnly: false
}).scrollIntoView());
el.buttonAddAzureProvider.addEventListener('click', () => createProvider({
  service: 'azure',
  enabled: true,
  apiKey: '',
  color: 'RoyalBlue',
  bgColor: 'LightGray',
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
  bgColor: 'LightGray',
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

function createOverride (override) {
  let template = document.importNode(el.templateDomain.content, true);
  let tpl = {
    divOverride: template.firstElementChild,
    divMatchDomainGroup: template.querySelector('div.match-domain-group'),
    inputMatchDomain: template.querySelector('[name="match-domain"]'),
    inputMatchRegex: template.querySelector('[name="match-regex"]'),
    divDedicatedCacheSizeGroup: template.querySelector('div.dedicated-cache-size-group'),
    inputDedicatedCache: template.querySelector('[name="dedicated-cache"]'),
    inputDedicatedCacheName: template.querySelector('[name="dedicated-cache-name"]'),
    inputDedicatedCacheSize: template.querySelector('[name="dedicated-cache-size"]'),
    inputCacheOnly: template.querySelector('[name="cache-only"]'),
    buttonDelete: template.querySelector('button.delete'),
    buttonFlushCache: template.querySelector('button.flush-cache')
  };
  tpl.inputMatchDomain.value = override.matchDomain;
  tpl.inputMatchRegex.checked = override.matchRegex;
  tpl.inputDedicatedCache.checked = override.dedicatedCache;
  tpl.inputDedicatedCacheName.value = override.dedicatedCacheName;
  tpl.inputDedicatedCacheSize.value = override.dedicatedCacheSize;
  tpl.inputCacheOnly.checked = override.cacheOnly;
  dedicatedCacheChanged();

  // Bind event handlers to the overrides form.
  tpl.inputDedicatedCache.addEventListener('change', () => dedicatedCacheChanged());
  tpl.buttonDelete.addEventListener('click', () => tpl.divOverride.parentNode.removeChild(tpl.divOverride));
  tpl.buttonFlushCache.addEventListener('click', async () => {
    const data = {};
    data[override.dedicatedCacheName] = [];
    await browser.storage.local.set(data);
    alert('Dedicated cache has been flushed');
  });

  function dedicatedCacheChanged () {
    if (tpl.inputDedicatedCache.checked) {
      tpl.divMatchDomainGroup.classList.add('col-md-8');
      tpl.divMatchDomainGroup.classList.remove('col-md-12');
      tpl.divDedicatedCacheSizeGroup.classList.remove('d-none');
      tpl.buttonFlushCache.classList.remove('d-none');
    } else {
      tpl.divMatchDomainGroup.classList.add('col-md-12');
      tpl.divMatchDomainGroup.classList.remove('col-md-8');
      tpl.divDedicatedCacheSizeGroup.classList.add('d-none');
      tpl.buttonFlushCache.classList.add('d-none');
    }    
  }
  
  el.divOverridesList.appendChild(template);
  divToOverrideMap.set(tpl.divOverride, () => ({
    matchDomain: tpl.inputMatchDomain.value,
    matchRegex: tpl.inputMatchRegex.checked,
    dedicatedCache: tpl.inputDedicatedCache.checked,
    dedicatedCacheName: tpl.inputDedicatedCacheName.value,
    dedicatedCacheSize: Number(tpl.inputDedicatedCacheSize.value),
    cacheOnly: tpl.inputCacheOnly.checked
  }));

  return tpl.divOverride;
}

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
    inputBgColor: template.querySelector('[name="bg-color"]'),
    spanBadgeNormal: template.querySelector('span.badge-normal'),
    spanBadgeWarning: template.querySelector('span.badge-warning'),
    inputWarnAfter: template.querySelector('[name="warn-after"]'),
    inputStopAfter: template.querySelector('[name="stop-after"]'),
    inputResetOn: template.querySelector('[name="reset-on"]'),
    inputQuotaKey: template.querySelector('[name="quota-key"]'),
    cellQuotaCharacters: template.querySelector('td.quota-characters'),
    buttonMoveUp: template.querySelector('button.move-up'),
    buttonMoveDown: template.querySelector('button.move-down'),
    buttonDelete: template.querySelector('button.delete'),
    buttonResetQuota: template.querySelector('button.reset-quota')
  };
  tpl.inputEnabled.checked = provider.enabled;
  tpl.inputApiKey.value = provider.apiKey;
  tpl.inputColor.value = provider.color || 'White';
  tpl.inputBgColor.value = provider.bgColor || 'Black';
  tpl.inputWarnAfter.value = provider.warnAfter;
  tpl.inputStopAfter.value = provider.stopAfter;
  tpl.inputResetOn.value = provider.resetOn;
  tpl.inputQuotaKey.value = provider.quotaKey;
  tpl.cellQuotaCharacters.innerText = quota.characters;
  previewBadge();

  // Bind event handlers to the provider form.
  tpl.buttonMoveUp.addEventListener('click', () => {
    if (tpl.divProvider.previousElementSibling) {
      tpl.divProvider.parentNode.insertBefore(tpl.divProvider, tpl.divProvider.previousElementSibling);
    }
  });
  tpl.buttonMoveDown.addEventListener('click', () => {
    if (tpl.divProvider.nextElementSibling) {
      tpl.divProvider.parentNode.insertBefore(tpl.divProvider.nextElementSibling, tpl.divProvider);
    }
  });
  tpl.buttonDelete.addEventListener('click', () => tpl.divProvider.parentNode.removeChild(tpl.divProvider));
  tpl.buttonResetQuota.addEventListener('click', async () => {
    let newQuota = Number.parseInt(prompt('Reset character quota to this amount:', 0));
    if (Number.isFinite(newQuota) && (newQuota >= 0)) {
      let data = await browser.storage.local.get({ quotas: {} });
      data.quotas[provider.quotaKey] = {
        month: new Date().getMonth(),
        characters: newQuota
      };
      await browser.storage.local.set(data);
      tpl.cellQuotaCharacters.innerText = newQuota;
      browser.runtime.sendMessage({
        topic: 'quotaEdited',
        quotaKey: provider.quotaKey
      });
    }
  });
  tpl.inputStopAfter.addEventListener('change', () => {
    tpl.inputWarnAfter.max = Number(tpl.inputStopAfter.value);
  });
  tpl.inputColor.addEventListener('change', previewBadge);
  tpl.inputBgColor.addEventListener('change', previewBadge);

  function previewBadge () {
    tpl.spanBadgeNormal.style.color = tpl.inputColor.value;
    tpl.spanBadgeNormal.style.backgroundColor = tpl.inputBgColor.value;
    tpl.spanBadgeWarning.style.color = tpl.inputBgColor.value;
    tpl.spanBadgeWarning.style.backgroundColor = tpl.inputColor.value;
  }

  el.divProvidersList.appendChild(template);
  divToProviderMap.set(tpl.divProvider, () => ({
    service: provider.service,
    enabled: tpl.inputEnabled.checked,
    apiKey: tpl.inputApiKey.value,
    color: tpl.inputColor.value,
    bgColor: tpl.inputBgColor.value,
    warnAfter: Number(tpl.inputWarnAfter.value),
    stopAfter: Number(tpl.inputStopAfter.value),
    resetOn: Number(tpl.inputResetOn.value),
    quotaKey: tpl.inputQuotaKey.value
  }));

  return tpl.divProvider;
}

// Save the options to local storage.
async function saveOptions (event) {
  event.preventDefault();
  event.stopPropagation();

  if (!el.optionsForm.checkValidity()) {
    return;
  }

  let results = await browser.storage.local.get();

  // Extract all named caches from settings.
  results[defaultCacheName] = results[defaultCacheName] || [];
  let cacheData = Object.keys(results)
    .filter(key => key.startsWith(cachePrefix))
    .reduce((data, key) => {
      data[key] = results[key];
      return data;
    }, {});

  let overrides = [].slice.call(el.divOverridesList.children)
    .filter(element => element.tagName === 'DIV')
    .map(divOverride => divToOverrideMap.get(divOverride)());

  // Delete caches for any overrides that no longer exist.
  Object.keys(cacheData)
    // Find caches that no longer exist.
    .filter(cacheName => cacheName !== defaultCacheName)
    .filter(cacheName => {      
      const override = overrides.find(override => override.dedicatedCacheName === cacheName);
      return ((override == null) || !override.dedicatedCache);
    })
    // Delete the caches.
    .forEach(cacheName => delete cacheData[cacheName]);

  // Truncate the default cache to size.
  const cacheSize = Number(el.inputCacheSize.value);
  let cache = cacheData[defaultCacheName];
  cache.length = Math.min(cache.length, cacheSize);
  
  // Truncate any dedicated caches that exceed their cache size.
  overrides
    .filter(override => override.dedicatedCache)
    .forEach(override => {
      let cache = cacheData[override.dedicatedCacheName];
      if (cache) {
        // Truncate the cache to size.
        cache.length = Math.min(cache.length, override.dedicatedCacheSize);      
      } else {
        // Create a new cache.
        cacheData[override.dedicatedCacheName] = [];
      }
    });

  let providers = [].slice.call(el.divProvidersList.children)
    .filter(element => element.tagName === 'DIV')
    .map(divProvider => divToProviderMap.get(divProvider)());

  // Delete quotas for any providers that no longer exist.
  let validQuotaKeys = new Set();
  providers.forEach(provider => validQuotaKeys.add(provider.quotaKey));
  Object.assign(quotas, results.quotas);
  Object.keys(quotas).forEach(quotaKey => {
    if (!validQuotaKeys.has(quotaKey)) {
      delete quotas[quotaKey];
    }
  });

  // Save all settings.
  await browser.storage.local.set({
    target: el.inputTarget.value,
    cacheSize,
    overrides,
    providers,    
    quotas
  });

  // Save all caches.
  await browser.storage.local.set(cacheData);

  alert('Settings have been saved');
}
