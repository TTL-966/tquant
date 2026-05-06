import { bridge } from './bridge.js';
import { formatStockDisplayHtml } from './chartRenderer.js';
import { searchStockSuggestions } from './stockData.js';

var suggestionTimer = null;

export function debounceSuggestions() {
    if (suggestionTimer) clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(function() {
        var input = document.getElementById('stockCodeInput');
        if (!input) return;
        var keyword = input.value.trim();
        if (keyword === '') {
            var container = document.getElementById('stockSuggestionsContainer');
            if (container) container.innerHTML = '';
            return;
        }
        searchStockSuggestions(keyword, bridge).then(function(list) {
            var container = document.getElementById('stockSuggestionsContainer');
            if (!container) return;
            container.innerHTML = '';
            if (list.length === 0) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'block';
            list.forEach(function(item) {
                var div = document.createElement('div');
                div.className = 'suggestion-item';
                div.style.cssText = 'padding:6px 12px; cursor:pointer; background:#1a2135; border-bottom:1px solid #2a314a; color:#ffffff;';
                div.innerHTML = formatStockDisplayHtml(item.code) + ' <span style="color:#9aa9cc;">' + item.name + '</span>';
                div.addEventListener('click', function() {
                    input.value = item.code;
                    container.innerHTML = '';
                    container.style.display = 'none';
                    var stockCode = item.code;
                    if (typeof loadStock === 'function') {
                        loadStock();
                    } else {
                        var btn = document.getElementById('stockSearchBtn');
                        if (btn) btn.click();
                    }
                });
                container.appendChild(div);
            });
        });
    }, 300);
}
