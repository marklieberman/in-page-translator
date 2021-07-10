'use strict';

(async function () {
  // Multiple inclusion guard.
  if (window.$$injectedTranslator) {
    return 'already-injected';
  } else {
    window.$$injectedTranslator = true;
    console.log('translator user script injected');
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Message listeners

  browser.runtime.onMessage.addListener((message) => {
    switch (message.topic) {
      case 'stopTranslate':
        stopPageTranslation();
        break;
    }
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Page translation

  const state = {
    alreadyTranslated: new WeakSet()
  };

  const settings = {
    target: 'en'
  };

  /**
   * Deduplicates items with identical input strings by aggregating the items into a single item.
   */
  function deduplicateItems (items) {
    let map = {};
    return items.reduce((deduped, item) => {
      let duplicate = map[item.input];
      if (duplicate) {
        // Found a duplicate item.
        if (duplicate.$dupes) {
          // Add to the duplicates collection of this item.
          duplicate.$dupes.push(item);
        } else {
          // Convert this item into a duplicate collection.
          duplicate.$dupes = [{
            item: duplicate.item,
            input: duplicate.input,
            replacer: duplicate.replacer
          }, item ];
          duplicate.item = null;
          duplicate.replacer = (_, output) => {
            // Invoke the replacer for each duplicated item.
            duplicate.$dupes.forEach(item => item.replacer(item.item, output, item));
          };
        }
      } else {
        // Not a duplicate item.
        map[item.input] = item;
        deduped.push(item);
      }

      return deduped;
    }, []);
  }

  /**
   * Translate the page.
   */
  async function translatePage () {
    let items = [];

    // Find text nodes.
    items.push(...(await getAllTextNodes(document.body)).map(item => ({
      item,
      input: item.data,
      replacer: (textNode, output) => {
        if (textNode.parentNode) {
          let newNode = document.createTextNode(output);
          state.alreadyTranslated.add(newNode);
          textNode.parentNode.replaceChild(newNode, textNode);
        }
      }
    })));

    // Find buttons with value attributes.
    items.push(...(await getAllWithAttribute(document.body, [
      'button[type=button]',
      'button[type=submit]',
      'input[type=submit]',
      'input[type=button]'
    ], 'value')).map(item => ({
      item,
      input: item.getAttribute('value'),
      replacer: (element, output) => {
        // Replace the value attribute.
        state.alreadyTranslated.add(element);
        element.setAttribute('value', output);
      }
    })));
    
    // Find inputs with placeholder attributes.
    items.push(...(await getAllWithAttribute(document.body, [
      'input[placeholder]' 
    ], 'placeholder')).map(item => ({
      item,
      input: item.getAttribute('placeholder'),
      replacer: (element, output) => {
        // Replace the value attribute.
        state.alreadyTranslated.add(element);
        element.setAttribute('placeholder', output);
      }
    })));

    // TODO Translate alt and title attributes.
    // Not doing this because they are rarely seen and will consume characters.

    // The document title.
    items.push({
      item: null,
      input: document.title,
      replacer: (_, output) => document.title = output
    });

    if (items.length) {
      // Deduplicate items with identical input strings.
      items = deduplicateItems(items);

      // Translate strings for all items.
      let translation = await browser.runtime.sendMessage({
        topic: 'translate',
        target: null,
        q: items.map(item => item.input)
      });

      if (!translation.error) {
        // Invoke the replacer for all items.
        items.forEach((item, i) => item.replacer(item.item,translation.outputs[i], item));
      } else {
        console.log('translation failed');
      }      
    }
  }

  /**
   * True if a string is a candidate for translation, otherwise false.
   */
  async function shouldTranslate (input) {
    if (!input || !input.trim().length) {
      // Ignore empty strings.
      return false;
    }

    // Use the browser's built-in language detection.
    // If the language is suspected to be something other than the target, attempt to translate.
    // This can miss some shorter strings but we are choosing to err on the side of fewer translations.
    let detected = await browser.i18n.detectLanguage(input);
    if (detected.languages.length) {
      if (detected.languages[0].language !== settings.target) {
        return true;
      }
    }

    // Remove all digits and punctuation and if anything remains, translate it.
    // Match anything not: whitespace, digits, latin, or punctuation.
    if (input.match(new RegExp('[^\\s\\d\\w\\p{P}]+', 'gu'))) {
      return true;
    }
    
    return false;
  }

  /**
   * Find all text nodes.
   */
  async function getAllTextNodes (startingElement) {  
    // Find all TEXT nodes using a tree walker.
    let node, nodes = [], treeWalker = document.createTreeWalker(startingElement, NodeFilter.SHOW_TEXT, null);  
    while((node = treeWalker.nextNode())) {
      // Check if the text content should be translated.
      if (!state.alreadyTranslated.has(node) 
        && node.parentNode.tagName !== 'SCRIPT'
        && node.parentNode.tagName !== 'NOSCRIPT'
        && await shouldTranslate(node.data)) {
        nodes.push(node);
      }
    }  
    return nodes;
  }

  /**
   * Find all buttons with value attributes.
   */
  async function getAllWithAttribute (startingElement, selectors, attribute) {
    let elements = [];
    for (let selector of selectors) {
      for (let element of startingElement.querySelectorAll(selector)) {
        if (!state.alreadyTranslated.has(element)) {
          let value = element.getAttribute(attribute);
          if (value && await shouldTranslate(value)) {
            elements.push(element);
          }
        }
      }  
    }
    return elements;
  }

  /**
   * Translate the page and schedule translation passes on mutation.
   */
  async function startPageTranslation () {
    // Determine the 
    let result = await browser.storage.local.get(settings);
    settings.target = result.target;

    // Create an observer to detect mutations after the first translation.
    if (!state.observer) {
      // Schedule a translation in the near future each time the DOM is mutated.
      // This functions as an accumulator when multiple mutations happen rapidly.
      state.observer = new MutationObserver(() => {
        if (state.nextPass) {
          clearTimeout(state.nextPass);
        }
        state.nextPass = setTimeout(translatePage, 600);
      });
    }

    // Immediately translate the page.
    await translatePage();

    // Connect the mutation obesever.
    state.observer.observe(document.body, { 
      subtree: true,
      childList: true 
    });
  }

  /**
   * Stop watching for mutations and scheduling translation passes.
   */
  function stopPageTranslation () {
    // Disconnect the mutation oberver.
    state.observer.disconnect();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Ready

  startPageTranslation();

})();

