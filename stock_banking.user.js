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

    // Observe the narrow panel area for changes so calculators can be re-added efficiently
    function setupPanelObserver() {
        if (window.__sb_panelObserver) return;
        try {
            function debounce(fn, wait) {
                let t = null;
                return function(...args) {
                    if (t) clearTimeout(t);
                    t = setTimeout(() => { t = null; fn(...args); }, wait);
                };
            }

            const tryShowForPanel = debounce(() => {
                const panel = document.querySelector('#panel-ownedTab');
                if (panel) {
                    const ul = window.__sb_lastUL || document.querySelector('ul[class^="stock___"]');
                    try { showCalculators(panel, ul); } catch (e) { /* ignore */ }
                }
            }, 100);

            function observePanel(panelEl) {
                if (!panelEl || panelEl.__sb_observing) return;
                panelEl.__sb_observing = true;
                const panelObs = new MutationObserver(tryShowForPanel);
                panelObs.observe(panelEl, { childList: true, subtree: true });
                panelEl.__sb_obs = panelObs;
            }

            const stockRoot = document.querySelector('[class^="stockMarket___"]') || document.body;
            const rootObs = new MutationObserver(debounce(() => {
                const panel = document.querySelector('#panel-ownedTab');
                if (panel) {
                    observePanel(panel);
                    tryShowForPanel();
                }
            }, 100));
            rootObs.observe(stockRoot, { childList: true, subtree: true });

            const existingPanel = document.querySelector('#panel-ownedTab');
            if (existingPanel) observePanel(existingPanel);

            window.__sb_panelObserver = rootObs;

            if (!window.__sb_clickHandlerAdded) {
                window.__sb_clickHandlerAdded = true;
                document.addEventListener('click', (ev) => {
                    const panel = ev.target && ev.target.closest ? ev.target.closest('#panel-ownedTab') : null;
                    if (panel) {
                        // try immediate, then short retries — fast re-add without heavy observer work
                        tryShowForPanel();
                        setTimeout(tryShowForPanel, 80);
                        setTimeout(tryShowForPanel, 300);
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
        intPart = intPart.replace(/,/g, '');

        // if nothing entered (no integer, no fraction, no suffix, no trailing dot) keep field empty
        if (!intPart && !fracPart && !suffix && !trailingDot) {
            el.value = '';
            el.setSelectionRange(0, 0);
            return;
        }

        // format integer part with thousands separators
        const intFormatted = intPart ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
        let newValue = fracPart ? (intFormatted + '.' + fracPart) : intFormatted;
        if (trailingDot && !fracPart) newValue = newValue + '.';
        if (suffix) newValue = newValue + suffix;

        el.value = newValue;
        // cheap caret handling: keep caret at same index if possible
        const pos = Math.min(caret, newValue.length);
        el.setSelectionRange(pos, pos);
    }

    // Attach formatting handlers to an input only once.
    function attachThousandsFormatter(input) {
        if (!input || input.dataset.thousandsFormatter) return;
        input.dataset.thousandsFormatter = '1';
        input.setAttribute('inputmode', 'numeric');
        // lightweight input handler: only sanitize allowed chars to avoid heavy work on each keystroke
        input.addEventListener('input', () => {
            try {
                const el = input;
                const prev = el.value || '';
                const selStart = el.selectionStart ?? prev.length;
                // keep digits, dot, comma and suffix letters
                let cleaned = prev.replace(/[^0-9kKmMb\.,]/g, '');
                // move any suffix to the end and keep at most one suffix
                const suffixMatch = cleaned.match(/([kKmMb])$/);
                const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : '';
                if (suffix) cleaned = cleaned.slice(0, -1);
                // collapse multiple dots to first dot + rest removed
                const firstDot = cleaned.indexOf('.');
                if (firstDot >= 0) {
                    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
                }
                // remove commas from integer part only (do not re-insert commas here)
                const parts = cleaned.split('.');
                parts[0] = parts[0].replace(/,/g, '');
                cleaned = parts.join('.');
                if (suffix) cleaned = cleaned + suffix;
                if (cleaned !== prev) {
                    const caret = Math.min(selStart, cleaned.length);
                    el.value = cleaned;
                    el.setSelectionRange(caret, caret);
                }
            } catch (e) { /* ignore */ }
        });
        // full formatting/expansion runs on blur (less frequent)
        input.addEventListener('blur', () => formatThousandsInput(input));
    }

    function createCalculatorBlock(placeholder, inputId, buttonId) {
        const block = document.createElement('div');
        block.className = 'actions___PIYmF withInput___ZVcue';
        block.style.marginTop = '10px';
        block.innerHTML = `
            <br>
            <div class="input-money-group success">
                <span class="input-money-symbol">$</span><input type="text" id="${inputId}" class="input-money" placeholder="${placeholder}" autocomplete="off"></div>
            <div style="margin-left: 10px"><button type="button" class="torn-btn gray" id="${buttonId}" style="margin-top: 4px;">Calc</button></div>
        `;
        return block;
    }

    function clearDefaultZero(inputEl) {
        if (!inputEl) return;
        if (inputEl.value === '0' || inputEl.value === '0.00') inputEl.value = '';
        inputEl.addEventListener('focus', () => { if (inputEl.value === '0' || inputEl.value === '0.00') inputEl.value = ''; });
    }

    function getStockPriceFromUL(ul) {
        if (!ul) return 0;
        try {
            const priceLi = ul.querySelector('li[data-name="priceTab"]') || ul.querySelector('li.stockPrice___WCQuw');
            if (!priceLi) return 0;
            const aria = priceLi.getAttribute('aria-label') || '';
            const m = aria.match(/\$[\d,]+(?:\.\d+)?/);
            if (m) return parseFloat(m[0].replace(/[$,]/g, ''));
            const priceDiv = priceLi.querySelector('.price___CTjJE');
            if (priceDiv) return parseFloat(priceDiv.textContent.replace(/[^0-9.]/g, '')) || 0;
        } catch (e) {}
        return 0;
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

        const stockPrice = getStockPriceFromUL(ul);

        if (buyBlock && buyExists && !panel.querySelector('#purchase_total')) {
            const buyCalc = createCalculatorBlock('Invest $', 'purchase_total', 'calc_buy');
            buyBlock.parentElement.appendChild(buyCalc);
            setTimeout(() => clearDefaultZero(buyCalc.querySelector('#purchase_total')), 60);
        }

        if (sellBlock && sellExists && !panel.querySelector('#selling_total')) {
            const sellCalc = createCalculatorBlock('Cash Out $', 'selling_total', 'calc_sell');
            sellBlock.parentElement.appendChild(sellCalc);
            setTimeout(() => clearDefaultZero(sellCalc.querySelector('#selling_total')), 60);
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
    }

})();

