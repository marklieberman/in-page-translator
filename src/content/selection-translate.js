'use strict';

/**
 * Find and translate all text nodes in the selection.
 */
(async function () {

  const settings = await browser.storage.local.get({
    target: 'en'
  });
  
  const override = await browser.runtime.sendMessage({
    topic: 'findOverride',
    host: location.host
  });

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
   * True if the tag type should be ignore, otherwise false.
   */
  function shouldIgnoreTagName (element) {
    switch (element.tagName) {
      case 'SCRIPT':
      case 'NOSCRIPT':
        return true;
      default:
        return false;
    }
  }

  /**
   * Find all text nodes in a selection.
   */
  async function getAllTextNodesInSelection () {  
    let selection = window.getSelection(), 
        nodes = [],
        node = null;

    for (let i = 0; i < selection.rangeCount; i++) {
      let range = selection.getRangeAt(i);
      node = range.startContainer;
      if (node === range.endContainer) {
        // Only single node in the selection.
        if (!shouldIgnoreTagName(node.parentNode) 
          && await shouldTranslate(node.data)) {
          nodes.push(node);
        }
      } else {
        // Find all TEXT nodes using a tree walker.
        let treeWalker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);  
        while((node = treeWalker.nextNode())) {
          // Check if the text content should be translated.
          if (selection.containsNode(node, true)
            && !shouldIgnoreTagName(node.parentNode)
            && await shouldTranslate(node.data)) {
            nodes.push(node);
          }
        }  
      }
    }

    return nodes;
  }

  /**
   * Translate the selection.
   */
  async function translateSelection () {
    let items = [];

    // Find text nodes.
    items.push(...(await getAllTextNodesInSelection()).map(item => ({
      item,
      input: item.data,
      replacer: (textNode, output) => {
        if (textNode.parentNode) {
          let newNode = document.createTextNode(output);
          textNode.parentNode.replaceChild(newNode, textNode);
        }
      }
    })));

    if (items.length) {
      // Deduplicate items with identical input strings.
      items = deduplicateItems(items);

      // Translate strings for all items.
      let translation = await browser.runtime.sendMessage({
        topic: 'translate',
        target: null,
        q: items.map(item => item.input),
        override,
        manual: true
      });

      if (!translation.error) {
        // Invoke the replacer for all items.
        items.forEach((item, i) => item.replacer(item.item,translation.outputs[i], item));
      } else {
        console.log('translation failed');
      }      
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Ready

  translateSelection();

})();

