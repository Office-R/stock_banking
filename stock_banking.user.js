// ==UserScript==
// @name         Stock Banking
// @version      0.9
// @description  Calculates how many stocks to buy/sell for a given amount
// @author       hundeja
// @match        https://www.torn.com/page.php?sid=stocks*
// @downloadURL  https://raw.githubusercontent.com/Office-R/stock_banking/refs/heads/main/stock_banking.user.js
// @updateURL    https://raw.githubusercontent.com/Office-R/stock_banking/refs/heads/main/stock_banking.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Wait until the stock market section appears in the DOM.
    const waitForStockMarket = () => new Promise((resolve) => {
        const existing = document.querySelector('[class^="stockMarket___"]');
        if (existing) return resolve(existing);
        const observer = new MutationObserver((_, obs) => {
            const element = document.querySelector('[class^="stockMarket___"]');
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });

    // Start after the stock market UI is present.
    waitForStockMarket().then(() => run()).catch(err => console.error('startup error', err));

    // Entry point: attach event listeners.
    function run() {
        monitorStockClicks();
        setupPanelObserver();
    }


    // Listen for clicks on the 'owned' tab; show calculators when the panel opens.
    function monitorStockClicks() {
        document.addEventListener('click', (event) => {
            const li = event.target.closest('li#ownedTab');
            if (!li) return;

            const ul = li.closest('ul[class^="stock___"]');
            if (ul && ul.id) {
                // remember last clicked UL so observer can re-add calculators for it
                try { window.__sb_lastUL = ul; } catch (e) { /* ignore */ }
                // small delay lets the panel render before we query it
                setTimeout(() => {
                    const panel = document.querySelector('#panel-ownedTab');
                    if (panel) showCalculators(panel, ul);
                }, 150);
            }
        });
    }

    // Observe document for changes to the owned panel so calculators can be re-added
    function setupPanelObserver() {
        if (window.__sb_panelObserver) return;
        try {
            // debounce handler to avoid frequent re-inserts during rapid updates
            let panelTimer = null;
            const obs = new MutationObserver((mutations) => {
                if (panelTimer) return;
                panelTimer = setTimeout(() => {
                    panelTimer = null;
                    const panel = document.querySelector('#panel-ownedTab');
                    if (panel) {
                        const ul = window.__sb_lastUL || document.querySelector('ul[class^="stock___"]');
                        try { showCalculators(panel, ul); } catch (e) { /* ignore */ }
                    }
                }, 500);
            });
            // observe a narrower root to reduce overhead
            const root = document.querySelector('[class^="stockMarket___"]') || document.body;
            obs.observe(root, { childList: true, subtree: true });
            window.__sb_panelObserver = obs;
            // also listen for clicks inside the panel to re-add calculators after actions
            if (!window.__sb_clickHandlerAdded) {
                window.__sb_clickHandlerAdded = true;
                document.addEventListener('click', (ev) => {
                    if (ev.target && ev.target.closest && ev.target.closest('#panel-ownedTab')) {
                        setTimeout(() => {
                            const panel = document.querySelector('#panel-ownedTab');
                            if (panel) {
                                const ul = window.__sb_lastUL || document.querySelector('ul[class^="stock___"]');
                                try { showCalculators(panel, ul); } catch (e) { /* ignore */ }
                            }
                        }, 200);
                    }
                }, true);
            }
        } catch (e) {
            /* ignore */
        }
    }
    // Convert strings like "2.5k", "1m" or plain numbers into numeric values.
    function parseAbbreviation(input) {
        if (!input) return NaN;
        const cleaned = input.trim().toLowerCase();
        const match = cleaned.match(/^([\d.,]+)\s*([kmb])?$/);
        if (!match) return NaN;
        let number = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2];
        if (suffix === 'k') number *= 1_000;
        if (suffix === 'm') number *= 1_000_000;
        if (suffix === 'b') number *= 1_000_000_000;
        return number;
    }


    // Set an input's value and notify frameworks (React, etc.) of the change.
    function setNativeValue(element, value) {
        const lastValue = element.value;
        element.value = value;
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue(lastValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // Format numeric inputs with thousands separators while preserving caret.
    function formatThousandsInput(el) {
        if (!el) return;
        const raw = el.value ?? '';
        const caret = el.selectionStart ?? raw.length;
        // normalize: keep digits, commas, dot and suffix letters
        let working = raw.replace(/[^0-9kKmMb\.,]/g, '');
        // extract suffix if present at end
        const suffixMatch = working.match(/([kKmMb])$/);
        const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : '';
        if (suffix) working = working.slice(0, -1);

        // allow at most one dot; if multiple, keep first and concatenate rest into fraction
        const firstDot = working.indexOf('.');
        let intPart = working;
        let fracPart = '';
        let trailingDot = false;
        if (firstDot >= 0) {
            intPart = working.slice(0, firstDot);
            fracPart = working.slice(firstDot + 1);
            // if original ends with dot and caret is at end, preserve trailing dot
            trailingDot = working.endsWith('.') || raw.endsWith('.');
            // remove any extra dots from fracPart
            fracPart = fracPart.replace(/\./g, '');
        }
        intPart = intPart.replace(/,/g, '') || '0';

        // format integer part with thousands separators
        const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        let newValue = fracPart ? (intFormatted + '.' + fracPart) : intFormatted;
        if (trailingDot && !fracPart) newValue = newValue + '.';
        if (suffix) newValue = newValue + suffix;
        // compute caret position: count digits+dot before original caret
        const nonFormatBefore = raw.slice(0, caret).split('').filter(ch => /[0-9\.]/.test(ch)).length;
        // map to newValue: find position after the nth digit/dot
        let pos = 0, count = 0;
        while (pos < newValue.length && count < nonFormatBefore) {
            if (/[0-9\.]/.test(newValue[pos])) count++;
            pos++;
        }
        // if caret was at end, keep it at end
        if (caret === raw.length) pos = newValue.length;
        el.value = newValue;
        el.setSelectionRange(pos, pos);
    }

    // Attach formatting handlers to an input only once.
    function attachThousandsFormatter(input) {
        if (!input || input.dataset.thousandsFormatter) return;
        input.dataset.thousandsFormatter = '1';
        input.setAttribute('inputmode', 'numeric');
        input.addEventListener('input', () => formatThousandsInput(input));
        input.addEventListener('blur', () => formatThousandsInput(input));
    }

    function showCalculators(panel, ul) {
        const buyBlock = panel.querySelector('.buyBlock___bIlBS .actions___PIYmF');
        const sellBlock = panel.querySelector('.sellBlock___A_yTW .actions___PIYmF');

        // helper: detect whether a visible Buy/Sell button exists in a block's container
        function hasActionButton(block, re) {
            if (!block) return false;
            const container = block.parentElement || block;
            const buttons = container.querySelectorAll('button');
            for (const b of buttons) {
                const text = (b.textContent || '').trim();
                if (re.test(text)) return true;
                const aria = b.getAttribute('aria-label') || '';
                if (re.test(aria)) return true;
            }
            return false;
        }

        const buyExists = hasActionButton(buyBlock, /buy/i);
        const sellExists = hasActionButton(sellBlock, /sell/i);

        // Determine the current stock price from the clicked UL (use aria-label as primary source)
        let stockPrice = 0;
        try {
            const priceLi = ul.querySelector('li[data-name="priceTab"]') || ul.querySelector('li.stockPrice___WCQuw');
            if (priceLi) {
                const aria = priceLi.getAttribute('aria-label') || '';
                const m = aria.match(/\$[\d,]+(?:\.\d+)?/);
                if (m) stockPrice = parseFloat(m[0].replace(/[$,]/g, ''));
                else {
                    const priceDiv = priceLi.querySelector('.price___CTjJE');
                    if (priceDiv) stockPrice = parseFloat(priceDiv.textContent.replace(/[^0-9.]/g, '')) || 0;
                }
            }
        } catch (e) {
            stockPrice = 0;
        }

        if (buyBlock && buyExists && !panel.querySelector('#purchase_total')) {
            const buyCalc = document.createElement('div');
            buyCalc.className = 'actions___PIYmF withInput___ZVcue'; 
            buyCalc.style.marginTop = '10px';

            buyCalc.innerHTML = `
                <br>
                <div class="input-money-group success">
                    <span class="input-money-symbol">$</span><input type="text" id="purchase_total" class="input-money" placeholder="Invest $" autocomplete="off"></div>
                <div style="margin-left: 10px"><button type="button" class="torn-btn gray" id="calc_buy" style="margin-top: 4px;">Calc</button></div>
            `;
            buyBlock.parentElement.appendChild(buyCalc);
        }

        if (sellBlock && sellExists && !panel.querySelector('#selling_total')) {
            const sellCalc = document.createElement('div');
            sellCalc.className = 'actions___PIYmF withInput___ZVcue'; 
            sellCalc.style.marginTop = '10px';

            sellCalc.innerHTML = `
                <br>
                <div class="input-money-group success">
                    <span class="input-money-symbol">$</span><input type="text" id="selling_total" class="input-money" placeholder="Cash Out $" autocomplete="off"></div>
                <div style="margin-left: 10px"><button type="button" class="torn-btn gray" id="calc_sell" style="margin-top: 4px;">Calc</button></div>
            `;
            sellBlock.parentElement.appendChild(sellCalc);
        }

        setTimeout(() => { 
            const purchaseInput = panel.querySelector('#purchase_total');
            const sellingInput = panel.querySelector('#selling_total');
            if (purchaseInput) attachThousandsFormatter(purchaseInput);
            if (sellingInput) attachThousandsFormatter(sellingInput);

            const buyBtn = panel.querySelector('#calc_buy');
            const sellBtn = panel.querySelector('#calc_sell');

            if (buyBtn && !buyBtn.dataset.sbListener) {
                buyBtn.dataset.sbListener = '1';
                buyBtn.addEventListener('click', () => {
                    const rawInput = panel.querySelector('#purchase_total')?.value || "";
                    const inputVal = parseAbbreviation(rawInput);
                    const price = stockPrice || 0;
                    if (!isNaN(inputVal) && price > 0) {
                        const shares = Math.ceil(inputVal / price);
                        const inputField = panel.querySelector('.buyBlock___bIlBS input.input-money');
                        if (inputField) setNativeValue(inputField, shares);
                    }
                });
            }

            if (sellBtn && !sellBtn.dataset.sbListener) {
                sellBtn.dataset.sbListener = '1';
                sellBtn.addEventListener('click', () => {
                    const rawInput = panel.querySelector('#selling_total')?.value || "";
                    const inputVal = parseAbbreviation(rawInput);
                    const price = stockPrice || 0;
                    if (!isNaN(inputVal) && price > 0) {
                        const shares = Math.ceil(inputVal / price);
                        const inputField = panel.querySelector('.sellBlock___A_yTW input.input-money');
                        if (inputField) setNativeValue(inputField, shares);
                    }
                });
            }

            // If buy/sell buttons are not present, remove respective calculator nodes to reduce work
            if (!buyExists) {
                const p = panel.querySelector('#purchase_total');
                if (p) {
                    const wrapper = p.closest('.withInput___ZVcue') || p.parentElement;
                    if (wrapper) wrapper.remove();
                }
            }
            if (!sellExists) {
                const s = panel.querySelector('#selling_total');
                if (s) {
                    const wrapper = s.closest('.withInput___ZVcue') || s.parentElement;
                    if (wrapper) wrapper.remove();
                }
            }
        }, 50);

        // no per-panel observer here; document-level observer handles re-adding
    }

})();

