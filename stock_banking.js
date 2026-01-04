// ==UserScript==
// @name         Stock Banking
// @version      0.9
// @description  A helper script to calculate how many of a certain stock to buy/sell based on a cash money value
// @author       hundeja
// @match        https://www.torn.com/page.php?sid=stocks*
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
                    if (panel) showCalculators(panel);
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
        const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;
        const digits = raw.replace(/\D/g, '');
        if (!digits) { el.value = ''; return; }
        const formatted = BigInt(digits).toLocaleString('en-US');
        el.value = formatted;
        let pos = 0, d = 0;
        while (pos < formatted.length && d < digitsBeforeCaret) {
            if (/\d/.test(formatted[pos])) d++;
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

    function showCalculators(panel) { 
        const buyBlock = panel.querySelector('.buyBlock___bIlBS .actions___PIYmF');
        const sellBlock = panel.querySelector('.sellBlock___A_yTW .actions___PIYmF');

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
                    const inputVal = parseFloat(panel.querySelector('#purchase_total')?.value.replace(/[^\d.]/g, ''));
                    const priceElements = panel.querySelectorAll('li[class^="current___"]');
                    let stockPriceText = null;

                    priceElements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text.startsWith('$')) stockPriceText = text;
                    });

                    const stockPrice = stockPriceText ? parseFloat(stockPriceText.replace(/[^\d.]/g, '')) : 0;
                    if (!isNaN(inputVal) && stockPrice > 0) {
                        const shares = Math.floor(inputVal / stockPrice);
                        const inputField = panel.querySelector('.buyBlock___bIlBS input.input-money');
                        if (inputField) setNativeValue(inputField, shares);
                    }
                });
            }

            if (sellBtn) {
                sellBtn.addEventListener('click', () => {
                    const rawInput = panel.querySelector('#selling_total')?.value || "";
                    const inputVal = parseAbbreviation(rawInput);
                    const priceElements = panel.querySelectorAll('li[class^="current___"]');
                    let stockPriceText = null;

                    priceElements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text.startsWith('$')) stockPriceText = text;
                    });

                    const stockPrice = stockPriceText ? parseFloat(stockPriceText.replace(/[^\d.]/g, '')) : 0;
                    if (!isNaN(inputVal) && stockPrice > 0) {
                        const shares = Math.floor(inputVal / stockPrice);
                        const inputField = panel.querySelector('.sellBlock___A_yTW input.input-money');
                        if (inputField) setNativeValue(inputField, shares);
                    }
                });
            }
        }, 50);
    }

})();

