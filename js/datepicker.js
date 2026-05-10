// js/datepicker.js
// 静态年份按钮版，彻底解决点击无响应问题

let picker = {
    el: null,
    input: null,
    activeDate: new Date(),
    yearPageStart: null
};

export function initDatePicker() {
    picker.el = document.getElementById('customDatePicker');
    if (!picker.el) return;

    document.getElementById('dpPrevMonth').onclick = () => changeMonth(-1);
    document.getElementById('dpNextMonth').onclick = () => changeMonth(1);
    document.getElementById('dpYearPrev').onclick = () => shiftYearPage(-6);
    document.getElementById('dpYearNext').onclick = () => shiftYearPage(6);

    // 绑定所有年份按钮事件（一次性绑定，后续只更新内容）
    const yearBtns = document.querySelectorAll('.dp-year-btn');
    yearBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const year = parseInt(this.getAttribute('data-year'));
            if (!isNaN(year)) {
                picker.activeDate.setFullYear(year);
                renderCalendar();
            }
        });
    });

    document.getElementById('dpClearBtn').onclick = () => {
        if (picker.input) {
            picker.input.value = '';
            hidePicker();
        }
    };
    document.getElementById('dpTodayBtn').onclick = () => {
        if (picker.input) {
            picker.input.value = formatDate(new Date());
            hidePicker();
        }
    };

    document.addEventListener('click', (e) => {
        if (picker.el && picker.el.style.display === 'block') {
            if (!picker.el.contains(e.target) && e.target !== picker.input) {
                hidePicker();
            }
        }
    });
}

export function bindDatePicker(inputElement) {
    inputElement.addEventListener('click', (e) => {
        e.stopPropagation();
        showPicker(inputElement);
    });
    inputElement.setAttribute('readonly', 'readonly');
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function showPicker(input) {
    picker.input = input;
    const val = input.value.trim();
    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        picker.activeDate = new Date(val);
    } else {
        picker.activeDate = new Date();
    }
    updateYearPageToInclude(picker.activeDate.getFullYear());
    renderCalendar();

    const rect = input.getBoundingClientRect();
    picker.el.style.left = rect.left + 'px';
    picker.el.style.top = (rect.bottom + window.scrollY + 5) + 'px';
    picker.el.style.display = 'block';
}

function hidePicker() {
    if (picker.el) picker.el.style.display = 'none';
}

function changeMonth(delta) {
    picker.activeDate.setMonth(picker.activeDate.getMonth() + delta);
    updateYearPageToInclude(picker.activeDate.getFullYear());
    renderCalendar();
}

function shiftYearPage(delta) {
    if (picker.yearPageStart === null) {
        updateYearPageToInclude(picker.activeDate.getFullYear());
    }
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;
    const maxYear = currentYear + 2;
    const pageSize = 6;
    let newStart = (picker.yearPageStart || minYear) + delta;
    if (newStart < minYear) newStart = minYear;
    if (newStart + pageSize - 1 > maxYear) newStart = maxYear - pageSize + 1;
    picker.yearPageStart = newStart;
    renderCalendar();
}

function updateYearPageToInclude(year) {
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;
    const maxYear = currentYear + 2;
    const pageSize = 6;
    let pageStart = minYear;
    while (pageStart + pageSize - 1 < year && pageStart + pageSize - 1 < maxYear) {
        pageStart += pageSize;
    }
    picker.yearPageStart = Math.max(minYear, pageStart);
}

function renderCalendar() {
    const year = picker.activeDate.getFullYear();
    const month = picker.activeDate.getMonth();
    document.getElementById('dpMonthYear').innerText = `${year}年${month + 1}月`;
    renderYearButtons();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const todayStr = formatDate(new Date());

    const grid = document.getElementById('dpGrid');
    grid.innerHTML = `
        <div style="color:#9aa9cc;">日</div>
        <div style="color:#9aa9cc;">一</div>
        <div style="color:#9aa9cc;">二</div>
        <div style="color:#9aa9cc;">三</div>
        <div style="color:#9aa9cc;">四</div>
        <div style="color:#9aa9cc;">五</div>
        <div style="color:#9aa9cc;">六</div>
    `;

    for (let i = firstDay - 1; i >= 0; i--) {
        const div = document.createElement('div');
        div.className = 'dp-cell other-month';
        div.textContent = prevMonthDays - i;
        grid.appendChild(div);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const div = document.createElement('div');
        div.className = 'dp-cell';
        div.textContent = d;
        if (dateStr === todayStr) div.classList.add('today');
        if (picker.input && picker.input.value === dateStr) div.classList.add('selected');
        div.addEventListener('click', () => {
            if (picker.input) {
                picker.input.value = dateStr;
                hidePicker();
            }
        });
        grid.appendChild(div);
    }
}

function renderYearButtons() {
    const container = document.getElementById('dpYearButtons');
    if (!container) return;

    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;
    const maxYear = currentYear + 2;
    const pageSize = 6;

    let start = picker.yearPageStart;
    if (start === null || start < minYear) start = minYear;
    if (start + pageSize - 1 > maxYear) start = maxYear - pageSize + 1;
    picker.yearPageStart = start;

    const buttons = container.querySelectorAll('.dp-year-btn');
    buttons.forEach((btn, index) => {
        const year = start + index;
        if (year <= maxYear) {
            btn.textContent = year;
            btn.setAttribute('data-year', year);
            btn.style.background = (year === picker.activeDate.getFullYear()) ? '#4f7eff' : '#2d3a5e';
            btn.style.display = 'inline-block';
        } else {
            btn.style.display = 'none';
        }
    });

    document.getElementById('dpYearPrev').style.visibility = (start > minYear) ? 'visible' : 'hidden';
    document.getElementById('dpYearNext').style.visibility = (start + pageSize - 1 < maxYear) ? 'visible' : 'hidden';
}