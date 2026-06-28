// js/logger.js
// Shared backtest logger: filter, export, max-entry cap, color-coded levels

var LEVEL_COLORS = { info: '#9aa9cc', warn: '#f2c94c', error: '#ff4c4c', success: '#4cff4c' };
var LEVEL_LABELS = { info: '信息', warn: '警告', error: '错误', success: '成功' };

export function Logger(containerId, toolbarContainerId, options) {
    options = options || {};
    this.containerId = containerId;
    this.toolbarContainerId = toolbarContainerId;
    this.maxEntries = options.maxEntries || 500;
    this.logs = [];           // { level, text, timestamp, fullDate }
    this.container = null;
    this.toolbarEl = null;
    this.currentFilter = 'all';
    this._userScrolledUp = false;
    this._scrollBound = false;
}

Logger.prototype.init = function() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) return;

    // Render toolbar into placeholder (or create one before the log box)
    var placeholder = document.getElementById(this.toolbarContainerId);
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = this.toolbarContainerId;
        this.container.parentNode.insertBefore(placeholder, this.container);
    }
    this.toolbarEl = placeholder;
    // Always rebuild toolbar to handle DOM rebuild on page re-entry
    this._renderToolbar();
    this._bindToolbarEvents();
    this._setupScrollDetection();
};

Logger.prototype._pad = function(n) {
    return n < 10 ? '0' + n : '' + n;
};

Logger.prototype._formatTime = function(d) {
    return this._pad(d.getHours()) + ':' + this._pad(d.getMinutes()) + ':' + this._pad(d.getSeconds());
};

Logger.prototype._formatFull = function(d) {
    return d.getFullYear() + '-' +
        this._pad(d.getMonth() + 1) + '-' +
        this._pad(d.getDate()) + ' ' +
        this._pad(d.getHours()) + ':' +
        this._pad(d.getMinutes()) + ':' +
        this._pad(d.getSeconds());
};

Logger.prototype.addLog = function(level, text) {
    if (!this.container) return;

    var now = new Date();
    var entry = {
        level: level,
        text: text,
        timestamp: this._formatTime(now),
        fullDate: this._formatFull(now)
    };
    this.logs.push(entry);

    // Trim from head if over max
    while (this.logs.length > this.maxEntries) {
        this.logs.shift();
        var first = this.container.querySelector('.log-entry');
        if (first) first.remove();
    }

    // Create and append DOM element
    var line = this._createLogElement(entry);
    if (this.currentFilter !== 'all' && this.currentFilter !== level) {
        line.style.display = 'none';
    }
    this.container.appendChild(line);

    // Auto-scroll unless user scrolled up
    if (!this._userScrolledUp) {
        this.container.scrollTop = this.container.scrollHeight;
    }
};

Logger.prototype.clearLog = function() {
    this.logs = [];
    this.currentFilter = 'all';
    if (this.container) {
        this.container.innerHTML = '';
    }
    this._resetFilterButtons();
};

Logger.prototype.setFilter = function(level) {
    this.currentFilter = level;
    if (!this.container) return;

    var entries = this.container.querySelectorAll('.log-entry');
    for (var i = 0; i < entries.length; i++) {
        if (level === 'all' || entries[i].getAttribute('data-level') === level) {
            entries[i].style.display = '';
        } else {
            entries[i].style.display = 'none';
        }
    }

    if (!this._userScrolledUp) {
        this.container.scrollTop = this.container.scrollHeight;
    }
};

Logger.prototype.exportLog = function() {
    var lines = [];
    for (var i = 0; i < this.logs.length; i++) {
        var e = this.logs[i];
        lines.push('[' + e.fullDate + '] [' + e.level.toUpperCase() + '] ' + e.text);
    }
    var content = lines.join('\n');

    var now = new Date();
    var filename = 'backtest_log_' +
        now.getFullYear() +
        this._pad(now.getMonth() + 1) +
        this._pad(now.getDate()) + '_' +
        this._pad(now.getHours()) +
        this._pad(now.getMinutes()) +
        this._pad(now.getSeconds()) + '.txt';

    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

Logger.prototype._createLogElement = function(entry) {
    var color = LEVEL_COLORS[entry.level] || '#9aa9cc';
    var line = document.createElement('div');
    line.className = 'log-entry';
    line.setAttribute('data-level', entry.level);
    line.style.cssText = 'color:' + color + '; margin-bottom:2px; word-break:break-all;';
    line.textContent = '[' + entry.timestamp + '] [' + entry.level.toUpperCase() + '] ' + entry.text;
    return line;
};

Logger.prototype._renderToolbar = function() {
    if (!this.toolbarEl) return;
    this.toolbarEl.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;align-items:center;';

    var filters = ['all', 'info', 'warn', 'error', 'success'];
    var labels = ['全部', '信息', '警告', '错误', '成功'];
    var html = '';
    for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        var isActive = f === 'all';
        var borderColor = f === 'all' ? '#323d5a' : (LEVEL_COLORS[f] || '#9aa9cc');
        var bg = isActive ? '#4f7eff' : 'transparent';
        var clr = isActive ? '#fff' : (LEVEL_COLORS[f] || '#9aa9cc');
        var border = isActive ? 'none' : ('1px solid ' + borderColor);
        html += '<button class="log-filter-btn' + (isActive ? ' log-filter-active' : '') + '" data-filter="' + f + '" ' +
            'style="background:' + bg + ';border:' + border + ';color:' + clr +
            ';padding:3px 10px;border-radius:12px;cursor:pointer;font-size:11px;white-space:nowrap;">' + labels[i] + '</button>';
    }
    // Export button (right-aligned via margin-left:auto on a wrapper, or just as another button)
    html += '<button class="log-export-btn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:3px 10px;border-radius:12px;cursor:pointer;font-size:11px;margin-left:auto;white-space:nowrap;">📄 导出日志</button>';

    this.toolbarEl.innerHTML = html;
};

Logger.prototype._bindToolbarEvents = function() {
    if (!this.toolbarEl) return;
    var self = this;

    var filterBtns = this.toolbarEl.querySelectorAll('.log-filter-btn');
    for (var i = 0; i < filterBtns.length; i++) {
        filterBtns[i].addEventListener('click', function() {
            var level = this.getAttribute('data-filter');
            self.setFilter(level);

            // Update button styles
            var allBtns = self.toolbarEl.querySelectorAll('.log-filter-btn');
            for (var j = 0; j < allBtns.length; j++) {
                var btn = allBtns[j];
                var f = btn.getAttribute('data-filter');
                btn.classList.remove('log-filter-active');
                if (f === level) {
                    btn.classList.add('log-filter-active');
                    btn.style.background = '#4f7eff';
                    btn.style.border = 'none';
                    btn.style.color = '#fff';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.border = '1px solid ' + (LEVEL_COLORS[f] || '#323d5a');
                    btn.style.color = LEVEL_COLORS[f] || '#9aa9cc';
                }
            }
        });
    }

    var exportBtn = this.toolbarEl.querySelector('.log-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            self.exportLog();
        });
    }
};

Logger.prototype._resetFilterButtons = function() {
    if (!this.toolbarEl) return;
    var btns = this.toolbarEl.querySelectorAll('.log-filter-btn');
    for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        var f = btn.getAttribute('data-filter');
        btn.classList.remove('log-filter-active');
        if (f === 'all') {
            btn.classList.add('log-filter-active');
            btn.style.background = '#4f7eff';
            btn.style.border = 'none';
            btn.style.color = '#fff';
        } else {
            btn.style.background = 'transparent';
            btn.style.border = '1px solid ' + (LEVEL_COLORS[f] || '#323d5a');
            btn.style.color = LEVEL_COLORS[f] || '#9aa9cc';
        }
    }
};

Logger.prototype._setupScrollDetection = function() {
    if (this._scrollBound) return;
    var self = this;
    this.container.addEventListener('scroll', function() {
        var box = self.container;
        var threshold = 30;
        self._userScrolledUp = (box.scrollTop + box.clientHeight < box.scrollHeight - threshold);
    });
    this._scrollBound = true;
};
