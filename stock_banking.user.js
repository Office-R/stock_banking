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
    }


    // Listen for clicks on the 'owned' tab; show calculators when the panel opens.
    function monitorStockClicks() {
        document.addEventListener('click', (event) => {
            const li = event.target.closest('li#ownedTab');
            if (!li) return;

            const ul = li.closest('ul[class^="stock___"]');
            if (ul && ul.id) {
                // small delay lets the panel render before we query it
                setTimeout(() => {
                    const panel = document.querySelector('#panel-ownedTab');
                    if (panel) showCalculators(panel, ul);
                }, 150);
            }
        });
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
        const compact = raw.replace(/\s+/g, '');
        const match = compact.match(/^([\d,]*\.?\d*)([kmbKMb])?$/);
        if (!match) {
            // strip invalid chars but keep digits, dots and suffix letters
            const cleaned = compact.replace(/[^0-9kKmMb\.\,]/g, '');
            el.value = cleaned;
            el.setSelectionRange(Math.min(caret, el.value.length), Math.min(caret, el.value.length));
            return;
        }
        let numPart = (match[1] || '').replace(/,/g, '');
        const suffix = (match[2] || '').toLowerCase();
        if (!numPart) { el.value = suffix ? ('0' + suffix) : ''; return; }

        // If input lost focus (blur), expand suffix to full numeric value
        const isFocused = (document.activeElement === el);
        if (!isFocused && suffix) {
            const multiplier = suffix === 'k' ? 1_000 : (suffix === 'm' ? 1_000_000 : 1_000_000_000);
            const value = parseFloat(numPart || '0') * multiplier;
            let formatted;
            if (Number.isInteger(value)) formatted = value.toLocaleString('en-US');
            else formatted = value.toLocaleString('en-US', { maximumFractionDigits: 8 }).replace(/\.?0+$/, '');
            el.value = formatted;
            el.setSelectionRange(el.value.length, el.value.length);
            return;
        }

        // While typing (focused) preserve suffix and show formatted integer part
        const parts = numPart.split('.');
        const intPart = parts[0] || '0';
        const fracPart = parts[1] || '';
        const formattedInt = intPart ? BigInt(intPart).toLocaleString('en-US') : '0';
        const formattedNumber = fracPart ? (formattedInt + '.' + fracPart) : formattedInt;
        el.value = suffix ? (formattedNumber + suffix) : formattedNumber;

        // Recompute caret position based on digits and dot
        const countBefore = raw.slice(0, caret).split('').filter(c => /[0-9\.]/.test(c)).length;
        let pos = 0, d = 0;
        while (pos < el.value.length && d < countBefore) {
            if (/[0-9\.]/.test(el.value[pos])) d++;
            pos++;
        }
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

        if (buyBlock && !panel.querySelector('#purchase_total')) {
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

        if (sellBlock && !panel.querySelector('#selling_total')) {
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
            attachThousandsFormatter(panel.querySelector('#purchase_total'));
            attachThousandsFormatter(panel.querySelector('#selling_total'));

            const buyBtn = panel.querySelector('#calc_buy');
            const sellBtn = panel.querySelector('#calc_sell');

            if (buyBtn) {
                buyBtn.addEventListener('click', () => {
                    const rawInput = panel.querySelector('#purchase_total')?.value || "";
                    const inputVal = parseAbbreviation(rawInput);
                    // use stockPrice determined from the UL; fallback to 0
                    const price = stockPrice || 0;
                    if (!isNaN(inputVal) && price > 0) {
                        const shares = Math.ceil(inputVal / price);
                        const inputField = panel.querySelector('.buyBlock___bIlBS input.input-money');
                        if (inputField) setNativeValue(inputField, shares);
                    }
                });
            }

            if (sellBtn) {
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
        }, 50);
    }

})();

