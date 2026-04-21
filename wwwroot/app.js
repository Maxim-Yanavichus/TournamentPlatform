// Глобальний стан додатка
let currentUser = null;
let tournaments = [];
let currentTournamentId = null;
let currentJuryTournamentId = null;
let pendingMembers = [];

// Автентифікація — ініціалізація та UI
async function initAuth() {
    try {
        const data = await fetch('/api/auth/me').then(r => r.json());
        currentUser = data.authenticated ? data : null;
    } catch {
        currentUser = null;
    }
    renderAuthUI();
    updateUIForRole();
}

function renderAuthUI() {
    const ui = document.getElementById('auth-ui');
    if (!currentUser) {
        ui.innerHTML = `
            <button onclick="openLoginModal()" class="btn btn-secondary" style="padding:7px 14px; font-size:0.85rem;">Увійти</button>
            <button onclick="openRegisterModal()" class="btn" style="padding:7px 14px; font-size:0.85rem;">Я не зареєстрований</button>`;
    } else {
        const icons = { Admin: '👑', Jury: '⚖️', Team: '👥' };
        const icon  = icons[currentUser.role] || '';
        const juryBtn = currentUser.role === 'Jury'
            ? `<button class="btn btn-secondary" onclick="openJuryView(null)" style="padding:7px 14px; font-size:0.85rem; border:1px solid var(--accent);">⚖️ Всі роботи</button>`
            : '';
        ui.innerHTML = `
            <span style="color:var(--text-muted); font-size:0.85rem; white-space:nowrap;">${icon} ${currentUser.name}</span>
            ${juryBtn}
            <button onclick="doLogout()" class="btn btn-secondary" style="padding:7px 14px; font-size:0.85rem;">Вийти</button>`;
    }
}

function openLoginModal() {
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-login').classList.remove('hidden');
    setTimeout(() => document.getElementById('login-email').focus(), 50);
}

function openRegisterModal() {
    document.getElementById('register-error').style.display = 'none';
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-register').classList.remove('hidden');
    setTimeout(() => document.getElementById('reg-user-name').focus(), 50);
}

function closeModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-login').classList.add('hidden');
    document.getElementById('modal-register').classList.add('hidden');
}

async function submitLogin(e) {
    e.preventDefault();
    const errDiv = document.getElementById('login-error');
    errDiv.style.display = 'none';
    try {
        currentUser = await api('/api/auth/login', 'POST', {
            email:    document.getElementById('login-email').value,
            password: document.getElementById('login-password').value
        });
        closeModals();
        renderAuthUI();
        updateUIForRole();
        loadTournaments();
    } catch (err) {
        errDiv.textContent = '⚠ ' + (err.message || 'Помилка входу');
        errDiv.style.display = 'block';
    }
}

async function submitRegister(e) {
    e.preventDefault();
    const errDiv = document.getElementById('register-error');
    errDiv.style.display = 'none';
    try {
        currentUser = await api('/api/auth/register-team', 'POST', {
            name:     document.getElementById('reg-user-name').value.trim(),
            email:    document.getElementById('reg-user-email').value,
            password: document.getElementById('reg-user-password').value
        });
        closeModals();
        renderAuthUI();
        updateUIForRole();
        loadTournaments();
    } catch (err) {
        errDiv.textContent = '⚠ ' + (err.message || 'Помилка реєстрації');
        errDiv.style.display = 'block';
    }
}

async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    renderAuthUI();
    updateUIForRole();
    showView('tournaments');
}

// Керування списком учасників команди
function addMemberInput() {
    if (pendingMembers.length >= 10) return;
    pendingMembers.push({ name: '', email: '' });
    renderMemberInputs();
}

function removeMemberInput(i) {
    pendingMembers.splice(i, 1);
    renderMemberInputs();
}

function renderMemberInputs() {
    const wrap = document.getElementById('members-list');
    if (!wrap) return;
    wrap.innerHTML = pendingMembers.map((m, i) => `
        <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:0.5rem; margin-bottom:0.5rem; align-items:start;">
            <input type="text" placeholder="ПІБ учасника" value="${m.name}" oninput="pendingMembers[${i}].name=this.value" style="margin-bottom:0;">
            <input type="email" placeholder="Email учасника" value="${m.email}" oninput="pendingMembers[${i}].email=this.value" style="margin-bottom:0;">
            <button type="button" onclick="removeMemberInput(${i})" style="padding:8px 11px; background:rgba(239,68,68,0.12); border:1px solid #ef4444; color:#ef4444; border-radius:8px; cursor:pointer;">✕</button>
        </div>`).join('');
    const btn = document.getElementById('add-member-btn');
    if (btn) {
        btn.disabled = pendingMembers.length >= 10;
        btn.textContent = pendingMembers.length >= 10 ? 'Макс. 10 учасників' : `+ Додати учасника (${pendingMembers.length}/10)`;
    }
}

// Взаємодія з API
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).message; } catch { }
        throw new Error(msg || 'Помилка сервера');
    }
    return res.json();
}

// Управління інтерфейсом (показ в'ю та помилок)
function updateUIForRole() {
    const role = currentUser?.role || 'Guest';
    document.body.className = `role-${role.toLowerCase()}`;
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', role !== 'Admin'));
    document.querySelectorAll('.team-only').forEach(el => el.classList.toggle('hidden', role !== 'Team'));
    document.querySelectorAll('.jury-only').forEach(el => el.classList.toggle('hidden', role !== 'Jury'));
}

function showView(viewId) {
    document.querySelectorAll('main > div').forEach(d => d.classList.add('hidden'));
    document.getElementById(`view-${viewId}`)?.classList.remove('hidden');
    if (viewId === 'tournaments') loadTournaments();
    if (viewId === 'jury') loadJurySubmissions();
}

function showFieldError(input, msg) {
    input.parentElement.querySelector('.field-error')?.remove();
    const err = document.createElement('div');
    err.className = 'field-error';
    err.textContent = '⚠ ' + msg;
    input.after(err);
    input.style.borderColor = '#ef4444';
    input.addEventListener('input', () => { err.remove(); input.style.borderColor = ''; }, { once: true });
    input.focus();
}

const STATUS_LABEL = { Draft: 'Чернетка', Registration: 'Реєстрація', Running: 'Триває', Evaluation: 'Оцінювання', Finished: 'Завершено' };
const STATUS_ICON  = { Draft: '📝', Registration: '📋', Running: '🏃', Evaluation: '⚖️', Finished: '🏁' };
const sLabel = s => STATUS_LABEL[s] || s;
const sIcon  = s => STATUS_ICON[s]  || '';

// Список турнірів (Головна сторінка)
async function loadTournaments() {
    tournaments = await api('/api/tournaments');
    const wrap = document.getElementById('tournament-list');
    if (!tournaments.length) {
        wrap.innerHTML = `<div class="empty-state"><div style="font-size:3rem;">🏆</div><p>Турнірів ще немає.</p></div>`;
        updateUIForRole(); return;
    }
    wrap.innerHTML = tournaments.map(t => `
        <div class="card tournament-card animate-fade ${t.status === 'Finished' ? 'card-finished' : ''}">
            <div>
                <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                    <span class="status-badge status-${t.status.toLowerCase()}">${sIcon(t.status)} ${sLabel(t.status)}</span>
                    ${t.status === 'Finished' ? '<span style="color:#9ca3af; font-size:0.8rem;">· Закрито</span>' : ''}
                </div>
                <h2>${t.name}</h2>
                <p style="color:var(--text-muted); margin-bottom:1rem;">${(t.description || '').slice(0, 120)}${(t.description || '').length > 120 ? '...' : ''}</p>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <button class="btn" onclick="openTournament(${t.id})">Відкрити</button>
                <button class="btn btn-secondary" onclick="loadLeaderboard(${t.id})">📊 Таблиця</button>
                <button class="btn jury-only hidden" onclick="openJuryView(${t.id})" style="border:1px solid var(--accent);">⚖️ Оцінити</button>
            </div>
        </div>`).join('');
    updateUIForRole();
}

function showCreateTournament() { showView('create-tournament'); }

document.getElementById('form-create-tournament').onsubmit = async e => {
    e.preventDefault();
    const maxT = document.getElementById('t-max-teams').value;
    const resD = document.getElementById('t-results-date').value;
    await api('/api/tournaments', 'POST', {
        name:              document.getElementById('t-name').value,
        description:       document.getElementById('t-desc').value,
        registrationStart: document.getElementById('t-reg-start').value || new Date().toISOString(),
        registrationEnd:   document.getElementById('t-reg-end').value   || new Date().toISOString(),
        maxTeams:    maxT ? parseInt(maxT) : null,
        resultsDate: resD ? new Date(resD).toISOString() : null,
        status: 'Registration'
    });
    e.target.reset();
    showView('tournaments');
};

// Деталі турніру та Керування статусами
async function openTournament(id) {
    currentTournamentId = id;
    tournaments = await api('/api/tournaments');
    const t = tournaments.find(x => x.id === id);
    if (!t) return;

    const isFinished = t.status === 'Finished';
    const isEval     = t.status === 'Evaluation';
    const isRunning  = t.status === 'Running';
    const now        = new Date();
    const regEnd     = new Date(t.registrationEnd);
    const regExpired = regEnd < now;

    let banner = '';
    if (isFinished)     banner = `<div class="status-full-banner banner-finished">🏁 Цей турнір завершено. Реєстрація та подачі закриті.</div>`;
    else if (isEval)    banner = `<div class="status-full-banner banner-eval">⚖️ Проводиться оцінювання робіт.</div>`;
    else if (isRunning) banner = `<div class="status-full-banner banner-running">🏃 Турнір в процесі. Здавайте роботи!</div>`;

    const extra = [];
    if (t.maxTeams)    extra.push(`👥 Макс. команд: ${t.maxTeams}`);
    if (t.resultsDate) extra.push(`🏆 Оголошення: ${new Date(t.resultsDate).toLocaleDateString('uk-UA')}`);

    document.getElementById('details-content').innerHTML = `
        ${banner}
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem; flex-wrap:wrap;">
            <span class="status-badge status-${t.status.toLowerCase()}">${sIcon(t.status)} ${sLabel(t.status)}</span>
            <h1 style="margin:0;">${t.name}</h1>
        </div>
        <p style="color:var(--text-muted);">${t.description || ''}</p>
        <div style="margin-top:0.75rem; color:var(--text-muted); font-size:0.85rem; display:flex; flex-wrap:wrap; gap:1.25rem;">
            <span>📅 Реєстрація: ${new Date(t.registrationStart).toLocaleDateString('uk-UA')} — <strong style="color:${regExpired ? '#ef4444' : 'inherit'}">${regEnd.toLocaleDateString('uk-UA')}${regExpired ? ' (закрита)' : ''}</strong></span>
            ${extra.map(s => `<span>${s}</span>`).join('')}
        </div>`;

    // Блок реєстрації команди
    const regWrap = document.getElementById('team-registration');
    const myTeamId = currentUser?.teamId;
    const role     = currentUser?.role;

    if (role === 'Team' && t.status === 'Registration') {
        regWrap.classList.remove('hidden');
        if (myTeamId) {
            const tournTeams = await api(`/api/teams/${id}`);
            const isHere = tournTeams.some(tm => +tm.id === +myTeamId);
            if (isHere) {
                regWrap.innerHTML = `<div class="success-banner">✅ Ваша команда зареєстрована в цьому турнірі!</div>`;
            } else {
                regWrap.innerHTML = `<div class="status-full-banner banner-info">ℹ️ Ви вже зареєстровані в іншому турнірі.</div>`;
            }
        } else if (regExpired) {
            regWrap.innerHTML = `<div class="status-full-banner banner-finished">⌛ Термін реєстрації закінчився <strong>${regEnd.toLocaleDateString('uk-UA')}</strong>. Нові команди не приймаються.</div>`;
        } else {
            pendingMembers = [];
            regWrap.innerHTML = `
                <hr style="margin:2rem 0; border:none; border-top:1px solid var(--glass-border);">
                <h3>Реєстрація Команди</h3>
                <form id="form-team-reg">
                    <div><input type="text" placeholder="Назва команди" id="reg-team-name" required></div>
                    <input type="text" placeholder="Капітан (ПІБ)" id="reg-captain-name" value="${currentUser?.name || ''}" required>
                    <div style="padding:0.6rem 0.75rem; background:rgba(255,255,255,0.04); border:1px solid var(--glass-border); border-radius:10px; color:var(--text-muted); font-size:0.9rem; margin-bottom:1rem;">
                        📧 ${currentUser?.email} <span style="font-size:0.78rem;">(ваш email як капітана)</span>
                    </div>
                    <div style="margin-bottom:0.5rem;"><label style="font-size:0.9rem; color:var(--text-muted);">Учасники команди (макс. 10):</label></div>
                    <div id="members-list"></div>
                    <button type="button" id="add-member-btn" onclick="addMemberInput()" class="btn btn-secondary" style="width:100%; margin-bottom:1rem;">+ Додати учасника (0/10)</button>
                    <button type="submit" class="btn">Зареєструватися</button>
                </form>`;
            document.getElementById('form-team-reg').onsubmit = handleTeamRegistration;
        }
    } else if (role === 'Team') {
        regWrap.classList.remove('hidden');
        regWrap.innerHTML = `<div class="status-full-banner banner-info">ℹ️ Реєстрація закрита (${sLabel(t.status)}).</div>`;
    } else if (!currentUser && t.status === 'Registration' && !regExpired) {
        regWrap.classList.remove('hidden');
        regWrap.innerHTML = `<div class="status-full-banner banner-info" style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
            <span>ℹ️ Для реєстрації команди потрібен обліковий запис.</span>
            <button onclick="openRegisterModal()" class="btn" style="padding:7px 16px; font-size:0.88rem;">Я не зареєстрований</button>
            <button onclick="openLoginModal()" class="btn btn-secondary" style="padding:7px 16px; font-size:0.88rem;">Увійти</button>
        </div>`;
    } else {
        regWrap.classList.add('hidden');
    }

    // Панель керування адміністратора
    const adminWrap = document.getElementById('admin-controls');
    adminWrap.classList.toggle('hidden', role !== 'Admin');
    if (role === 'Admin') {
        const STEPS = [
            { key: 'Registration', icon: '📋', label: 'Реєстрація', desc: 'Команди можуть реєструватися. Додайте раунди.', nextLabel: 'Розпочати турнір →', nextKey: 'Running', warn: 'Розпочати турнір? Нові реєстрації команд будуть закриті.' },
            { key: 'Running',      icon: '🏃', label: 'Триває',     desc: 'Команди здають роботи. Реєстрація закрита.',     nextLabel: 'Перейти до оцінювання →', nextKey: 'Evaluation', warn: 'Перевести турнір в режим оцінювання? Подача нових робіт буде закрита.' },
            { key: 'Evaluation',   icon: '⚖️', label: 'Оцінювання', desc: 'Журі оцінює роботи. Подача закрита.',            nextLabel: 'Завершити турнір →', nextKey: 'Finished', warn: 'Завершити турнір? Дія незворотна.' },
            { key: 'Finished',     icon: '🏁', label: 'Завершено',  desc: 'Турнір завершено. Усі дані зафіксовані.',        nextLabel: null, nextKey: null, warn: null },
        ];
        const idx  = STEPS.findIndex(s => s.key === t.status);
        const cur  = STEPS[idx] ?? STEPS[0];
        const next = cur.nextKey ? STEPS.find(s => s.key === cur.nextKey) : null;

        const stepper = STEPS.map((s, i) => `
            <div class="stepper-step ${i < idx ? 'step-done' : i === idx ? 'step-active' : 'step-future'}">
                <div class="stepper-circle">${i < idx ? '✓' : s.icon}</div>
                <div class="stepper-label">${s.label}</div>
            </div>
            ${i < STEPS.length - 1 ? `<div class="stepper-line ${i < idx ? 'line-done' : ''}"></div>` : ''}`
        ).join('');

        adminWrap.innerHTML = `
            <h3>Керування турніром</h3>
            <div class="stepper-wrap">${stepper}</div>
            <div class="stage-info-box">
                <div class="stage-icon-big">${cur.icon}</div>
                <div>
                    <div style="font-weight:700; font-size:1.1rem; margin-bottom:0.25rem;">${cur.label}</div>
                    <div style="color:var(--text-muted); font-size:0.9rem;">${cur.desc}</div>
                </div>
            </div>
            ${next
                ? `<button class="btn btn-next-stage" onclick="advanceStage(${id},'${next.key}',\`${cur.warn}\`)">${cur.nextLabel}</button>`
                : `<div style="color:#9ca3af; font-size:0.9rem; font-style:italic;">Це фінальний етап. Турнір завершено.</div>`}
            <hr style="margin:1.5rem 0; border:none; border-top:1px solid var(--glass-border);">
            <button class="btn" onclick="showCreateRound()" ${isFinished || idx > 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>+ Додати Раунд</button>
            ${idx > 0 && !isFinished ? '<p style="color:var(--text-muted); font-size:0.8rem; margin-top:0.5rem;">Раунди можна додавати лише на етапі Реєстрації.</p>' : ''}
            <div id="round-list" style="margin-top:1rem;"></div>`;
        loadRounds(id);
    }

    // Блок подачі робіт командою
    const teamWrap = document.getElementById('team-controls');
    teamWrap.classList.toggle('hidden', role !== 'Team');
    if (role === 'Team') {
        const isReg = t.status === 'Registration';
        document.querySelector('#team-controls h3').textContent =
            isFinished ? '🏁 Турнір завершено — подача закрита' :
            isEval     ? '⚖️ Оцінювання — можна лише змінити існуючі роботи' :
            isReg      ? '📝 Реєстрація — подача закрита до початку турніру' :
                         '📤 Подача результатів';
        loadActiveRounds(id, isFinished, isEval, isReg);
    }

    showView('tournament-details');
    updateUIForRole();
    loadAnnouncements(id);
}

async function advanceStage(id, newStatus, warn) {
    if (newStatus === 'Running') {
        const rounds = await api(`/api/rounds/${id}`);
        if (!rounds.length) {
            alert('⚠️ Неможливо розпочати турнір без раундів!\n\nСпочатку додайте хоча б один раунд.');
            return;
        }
    }
    if (!confirm(`⚠️ ${warn}\n\nПродовжити?`)) return;
    await fetch(`/api/tournaments/${id}/status?status=${newStatus}`, { method: 'PATCH' });
    openTournament(id);
}

// Реєстрація команди на турнір
async function handleTeamRegistration(e) {
    e.preventDefault();
    const nameInput = document.getElementById('reg-team-name');

    // Перевірка унікальності email серед учасників
    const filledEmails = pendingMembers
        .filter(m => m.email && m.email.trim())
        .map(m => m.email.trim().toLowerCase());
    const uniqueEmails = new Set(filledEmails);
    if (filledEmails.length !== uniqueEmails.size) {
        alert('⚠ Кожен учасник повинен мати унікальну електронну пошту!');
        return;
    }
    if (currentUser?.email && filledEmails.includes(currentUser.email.toLowerCase())) {
        alert('⚠ Email учасника не може співпадати з email капітана!');
        return;
    }

    const members = pendingMembers.filter(m => m.name.trim()).map(m => m.email ? `${m.name} <${m.email}>` : m.name).join(', ');
    try {
        await api('/api/teams', 'POST', {
            tournamentId: currentTournamentId,
            name:         nameInput.value.trim(),
            captainName:  document.getElementById('reg-captain-name').value,
            captainEmail: currentUser?.email || '',
            members
        });
        await initAuth();
        pendingMembers = [];
        openTournament(currentTournamentId);
    } catch (err) {
        showFieldError(nameInput, err.message || 'Помилка');
    }
}

// Керування Раундами (для адміністратора)
async function loadRounds(tournamentId) {
    const rounds = await api(`/api/rounds/${tournamentId}`);
    const now = new Date();
    document.getElementById('round-list').innerHTML = rounds.length
        ? rounds.map(r => {
            const dl      = new Date(r.deadline);
            const expired = dl < now;
            return `
            <div style="padding:0.75rem 1rem; background:rgba(255,255,255,0.05); border-radius:10px; margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <div>
                    <strong>${r.name}</strong>
                    ${r.description ? `<p style="color:var(--text-muted); font-size:0.82rem; margin:0.2rem 0 0;">${r.description}</p>` : ''}
                </div>
                <span style="color:${expired ? '#ef4444' : 'var(--text-muted)'}; font-size:0.82rem; white-space:nowrap; flex-shrink:0;">
                    ${expired ? '🔒' : '⏰'} ${dl.toLocaleString('uk-UA')}${expired ? ' (закрито)' : ''}
                </span>
            </div>`;
        }).join('')
        : '<p style="color:var(--text-muted); margin-top:0.5rem;">Раундів ще немає.</p>';
}

function showCreateRound() {
    if (document.getElementById('new-round-form')) return;
    const tomorrow = new Date(Date.now() + 86400000);
    const iso = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const el = document.createElement('div');
    el.id = 'new-round-form';
    el.style.cssText = 'background:rgba(99,102,241,0.08); border:1px solid var(--glass-border); border-radius:14px; padding:1.25rem; margin-bottom:0.75rem;';
    el.innerHTML = `
        <h4 style="margin:0 0 0.75rem;">➕ Новий раунд</h4>
        <input type="text" id="nr-name" placeholder="Назва раунду" required style="margin-bottom:0.5rem;">
        <input type="text" id="nr-desc" placeholder="Опис (необов'язково)" style="margin-bottom:0.5rem;">
        <label style="display:block; margin-bottom:0.3rem; font-size:0.88rem; color:var(--text-muted);">Дедлайн подачі</label>
        <div onclick="document.getElementById('nr-deadline').showPicker()" style="cursor:pointer; margin-bottom:0.75rem;">
            <input type="datetime-local" id="nr-deadline" value="${iso}" style="pointer-events:none;">
        </div>
        <div style="display:flex; gap:0.5rem;">
            <button class="btn" onclick="submitNewRound()">✅ Додати раунд</button>
            <button class="btn btn-secondary" onclick="document.getElementById('new-round-form').remove()">Скасувати</button>
        </div>`;
    document.getElementById('round-list').prepend(el);
    document.getElementById('nr-name').focus();
}

async function submitNewRound() {
    const name = document.getElementById('nr-name')?.value.trim();
    const desc = document.getElementById('nr-desc')?.value.trim() || '';
    const dl   = document.getElementById('nr-deadline')?.value;
    if (!name) { document.getElementById('nr-name').style.borderColor = '#ef4444'; document.getElementById('nr-name').focus(); return; }
    await api('/api/rounds', 'POST', {
        tournamentId: currentTournamentId, name, description: desc, requirements: '',
        deadline: dl ? new Date(dl).toISOString() : new Date(Date.now() + 86400000).toISOString()
    });
    document.getElementById('new-round-form')?.remove();
    loadRounds(currentTournamentId);
}

// Подача та редагування робіт командами
async function loadActiveRounds(tournamentId, locked, editOnly, regStage) {
    const rounds = await api(`/api/rounds/${tournamentId}`);
    const wrap   = document.getElementById('active-rounds-for-submission');
    const myTeamId = currentUser?.teamId;

    if (!rounds.length) { wrap.innerHTML = '<p style="color:var(--text-muted);">Раундів немає.</p>'; return; }
    if (locked)         { wrap.innerHTML = '<p style="color:var(--text-muted);">Подача закрита на цьому етапі.</p>'; return; }
    if (regStage)       { wrap.innerHTML = '<div class="status-full-banner banner-info">📝 Подача робіт буде доступна після того, як адміністратор розпочне турнір.</div>'; return; }

    const now = new Date();
    let mySubs = [];
    if (myTeamId) {
        const all = await api(`/api/submissions?tournamentId=${tournamentId}`);
        mySubs = all.filter(s => +s.teamId === +myTeamId);
    }

    wrap.innerHTML = rounds.map(r => {
        const sub      = mySubs.find(s => +s.roundId === +r.id);
        const deadline = new Date(r.deadline);
        const expired  = deadline < now;
        const modInfo  = sub?.lastModified
            ? `<div style="color:var(--text-muted); font-size:0.78rem; margin-top:0.4rem;">🗓 Змінено: ${new Date(sub.lastModified).toLocaleString('uk-UA')}</div>`
            : sub
            ? `<div style="color:var(--text-muted); font-size:0.78rem; margin-top:0.4rem;">🗓 Здано: ${new Date(sub.timestamp).toLocaleString('uk-UA')}</div>`
            : '';

        if (sub) {
            const canEdit = !expired || editOnly;
            return `
            <div class="card card-submitted" id="round-card-${r.id}" style="margin-top:1rem;">
                <div class="evaluated-badge" style="margin-bottom:0.75rem;">✓ Роботу здано</div>
                <h4>${r.name}</h4>
                <p style="color:var(--text-muted); font-size:0.85rem;">⏰ Дедлайн: <strong style="color:${expired ? '#ef4444' : 'inherit'}">${deadline.toLocaleString('uk-UA')}${expired ? ' (закрито)' : ''}</strong></p>
                <div style="margin:0.5rem 0; display:flex; gap:1.25rem;">
                    <a href="${sub.githubUrl}" target="_blank" style="color:var(--accent); text-decoration:none;">🔗 GitHub</a>
                    <a href="${sub.videoUrl}"  target="_blank" style="color:var(--accent); text-decoration:none;">🎬 Відео</a>
                </div>
                <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:0.4rem;">${sub.description || ''}</p>
                ${modInfo}
                ${canEdit
                    ? `<button class="btn btn-secondary" style="margin-top:0.75rem;" onclick="showEditSubmission(${r.id},'${encodeURIComponent(sub.githubUrl)}','${encodeURIComponent(sub.videoUrl)}','${encodeURIComponent(sub.description || '')}')">✏️ Змінити</button>`
                    : `<p style="color:#ef4444; font-size:0.82rem; margin-top:0.75rem;">🔒 Дедлайн минув — зміни заблоковані</p>`}
            </div>`;
        }
        if (editOnly) return `
            <div class="card" style="margin-top:1rem; opacity:0.6;">
                <h4>${r.name}</h4>
                <p style="color:var(--text-muted); font-size:0.85rem;">⏰ ${deadline.toLocaleString('uk-UA')}</p>
                <p style="color:#c084fc; font-size:0.9rem;">⚖️ Прийом нових робіт закрито (стадія оцінювання).</p>
            </div>`;
        if (expired) return `
            <div class="card" style="margin-top:1rem; opacity:0.55;">
                <h4>${r.name}</h4>
                <p style="color:#ef4444; font-size:0.85rem;">⏰ ${deadline.toLocaleString('uk-UA')} (закрито)</p>
                <p style="color:var(--text-muted); font-size:0.9rem;">🔒 Термін подачі минув.</p>
            </div>`;
        return `
        <div class="card" style="margin-top:1rem;" id="round-card-${r.id}">
            <h4>${r.name}</h4>
            ${r.description ? `<p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:0.5rem;">${r.description}</p>` : ''}
            <p style="color:var(--text-muted); font-size:0.85rem;">⏰ Дедлайн: <strong>${deadline.toLocaleString('uk-UA')}</strong></p>
            <form onsubmit="submitWork(event,${r.id})" style="margin-top:0.75rem;">
                <input type="url" placeholder="https://github.com/..." required>
                <input type="url" placeholder="Посилання на відео" required>
                <input type="text" placeholder="Короткий опис рішення">
                <button type="submit" class="btn">📤 Здати роботу</button>
            </form>
        </div>`;
    }).join('');
}

function showEditSubmission(roundId, ghEnc, vidEnc, descEnc) {
    const card = document.getElementById(`round-card-${roundId}`);
    if (!card) return;
    const gh  = ghEnc   ? decodeURIComponent(ghEnc)   : '';
    const vid = vidEnc  ? decodeURIComponent(vidEnc)  : '';
    const d   = descEnc ? decodeURIComponent(descEnc) : '';
    card.innerHTML = `
        <div class="evaluated-badge" style="margin-bottom:0.75rem;">✏️ Редагування</div>
        <form onsubmit="submitWork(event,${roundId})" style="margin-top:0.5rem;">
            <input type="url" value="${gh}" required>
            <input type="url" value="${vid}" required>
            <input type="text" value="${d}">
            <div style="display:flex; gap:0.5rem;">
                <button type="submit" class="btn">💾 Зберегти</button>
                <button type="button" class="btn btn-secondary" onclick="loadActiveRounds(${currentTournamentId})">Скасувати</button>
            </div>
        </form>`;
}

async function submitWork(e, roundId) {
    e.preventDefault();
    if (!currentUser?.teamId) { alert('Спочатку зареєструйте команду в цьому турнірі!'); return; }
    const inputs = e.target.querySelectorAll('input');
    try {
        await api('/api/submissions', 'POST', {
            roundId, teamId: parseInt(currentUser.teamId),
            githubUrl: inputs[0].value, videoUrl: inputs[1].value, description: inputs[2].value
        });
        loadActiveRounds(currentTournamentId);
    } catch (err) { alert('❌ ' + err.message); }
}

// Система Оголошень (Оголошення)
async function loadAnnouncements(tournamentId) {
    const sec = document.getElementById('announcements-section');
    if (!sec) return;
    let anns;
    try { anns = await api(`/api/announcements/${tournamentId}`); } catch { anns = []; }

    const isAdmin   = currentUser?.role === 'Admin';
    const key       = `ann_collapsed_${tournamentId}`;
    const collapsed = localStorage.getItem(key) === '1';

    const items = anns.map(a => {
        const dt   = new Date(a.createdAt).toLocaleString('uk-UA');
        const html = a.content
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:var(--accent);">$1</a>')
            .replace(/\n/g, '<br>');
        return `
        <div class="announcement-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.75rem;">
                <div style="flex:1;"><div class="ann-content">${html}</div><div class="ann-meta">📅 ${dt}</div></div>
                ${isAdmin ? `<button onclick="deleteAnnouncement(${a.id},${tournamentId})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;flex-shrink:0;">✕</button>` : ''}
            </div>
        </div>`;
    }).join('') || '<p style="color:var(--text-muted); font-size:0.88rem;">Оголошень ще немає.</p>';

    sec.innerHTML = `
        <div style="border-top:1px solid var(--glass-border); padding-top:1.25rem;">
            <div style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; user-select:none;" onclick="toggleAnnouncements(${tournamentId})">
                <span style="font-size:0.88rem; color:var(--text-muted); flex:1;">📢 Оголошення${anns.length ? ` (${anns.length})` : ''}</span>
                <span id="ann-icon" style="color:var(--text-muted); font-size:0.8rem;">${collapsed ? '▼' : '▲'}</span>
            </div>
            <div id="ann-body" style="display:${collapsed ? 'none' : 'block'}; margin-top:0.75rem;">
                ${isAdmin ? `
                <textarea id="ann-input" rows="2" placeholder="Напишіть повідомлення... (посилання https://... підтримуються)" style="width:100%;resize:vertical;font-family:inherit;padding:0.6rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:8px;color:var(--text);font-size:0.88rem;box-sizing:border-box;"></textarea>
                <button class="btn" style="margin-top:0.4rem; padding:7px 16px; font-size:0.88rem;" onclick="createAnnouncement(${tournamentId})">📨 Опублікувати</button>
                <div style="margin-top:0.75rem;"></div>` : ''}
                ${items}
            </div>
        </div>`;
}

function toggleAnnouncements(tournamentId) {
    const body = document.getElementById('ann-body');
    const icon = document.getElementById('ann-icon');
    if (!body) return;
    const show = body.style.display === 'none';
    body.style.display = show ? 'block' : 'none';
    icon.textContent = show ? '▲' : '▼';
    localStorage.setItem(`ann_collapsed_${tournamentId}`, show ? '0' : '1');
}

async function createAnnouncement(tournamentId) {
    const input   = document.getElementById('ann-input');
    const content = input?.value.trim();
    if (!content) { input.style.borderColor = '#ef4444'; input.focus(); return; }
    input.style.borderColor = '';
    await api('/api/announcements', 'POST', { tournamentId, content });
    input.value = '';
    loadAnnouncements(tournamentId);
}

async function deleteAnnouncement(id, tournamentId) {
    if (!confirm('Видалити оголошення?')) return;
    await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
    loadAnnouncements(tournamentId);
}

// Таблиця лідерів (Таблиця)
async function loadLeaderboard(tournamentId) {
    const data   = await api(`/api/leaderboard/${tournamentId}`);
    const t      = tournaments.find(x => x.id === tournamentId);
    const medals = ['🥇', '🥈', '🥉'];
    document.getElementById('leaderboard-title').textContent = t ? `${t.name} — Таблиця лідерів` : 'Таблиця лідерів';
    document.getElementById('leaderboard-body').innerHTML = data.length
        ? data.map((row, i) => {
            const score = row.hasEvaluations ? `<span class="score-badge">${row.score.toFixed(1)}</span>` : `<span style="color:var(--text-muted); font-size:0.85rem; font-style:italic;">Не оцінено</span>`;
            const place = row.hasEvaluations ? (medals[i] || '#' + (i + 1)) : '—';
            const cls   = i === 0 && row.hasEvaluations ? 'row-gold' : i === 1 && row.hasEvaluations ? 'row-silver' : i === 2 && row.hasEvaluations ? 'row-bronze' : '';
            return `<tr class="${cls}"><td class="rank">${place}</td><td><strong>${row.name}</strong></td><td>${score}</td></tr>`;
        }).join('')
        : `<tr><td colspan="3" style="color:var(--text-muted); padding:2rem; text-align:center;">Команд ще немає.</td></tr>`;
    showView('leaderboard');
}

// Робоче місце Журі (Оцінювання)
function openJuryView(tournamentId) {
    currentJuryTournamentId = tournamentId;
    showView('jury');
}

async function loadJurySubmissions() {
    const param = currentJuryTournamentId ? `?tournamentId=${currentJuryTournamentId}` : '';
    if (!tournaments.length) tournaments = await api('/api/tournaments');
    const t = currentJuryTournamentId ? tournaments.find(x => x.id === currentJuryTournamentId) : null;
    document.getElementById('jury-title').textContent = t ? `⚖️ Оцінювання: ${t.name}` : '⚖️ Оцінювання';

    const wrap = document.getElementById('submissions-to-evaluate');
    if (t && t.status !== 'Evaluation' && t.status !== 'Finished') {
        wrap.innerHTML = `<div class="status-full-banner banner-info" style="grid-column:1/-1;">ℹ️ Оцінювання ще не розпочато. Статус: <strong>${sIcon(t.status)} ${sLabel(t.status)}</strong>.<br><span style="font-size:0.85rem; opacity:0.8;">Адміністратор має перевести турнір в стадію «Оцінювання».</span></div>`;
        return;
    }

    const [subs, evals] = await Promise.all([api(`/api/submissions${param}`), api('/api/evaluations')]);
    if (!subs.length) { wrap.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center;">📭 Поданих робіт немає.</p>'; return; }

    const finished = t?.status === 'Finished';
    wrap.innerHTML = subs.map(s => {
        const ev   = evals.find(e => +e.submissionId === +s.id);
        const ts   = ev ? ev.techScore : '—';
        const fs   = ev ? ev.functionalityScore : '—';
        const note = ev ? (ev.comment || '') : '';

        if (finished) return `
            <div class="card animate-fade ${ev ? 'card-evaluated' : ''}" style="opacity:${ev ? 1 : 0.6}">
                ${ev ? '<div class="evaluated-badge">✓ Фінальна оцінка</div>' : '<div style="color:#9ca3af; font-size:0.8rem; margin-bottom:0.5rem;">Не оцінено</div>'}
                <h3>${s.teamName}</h3>
                <p style="color:var(--text-muted); font-size:0.85rem;">📍 ${s.roundName}</p>
                <div style="margin:0.75rem 0; display:flex; gap:1.5rem;">
                    <a href="${s.githubUrl}" target="_blank" style="color:var(--accent); text-decoration:none;">🔗 GitHub</a>
                    <a href="${s.videoUrl}"  target="_blank" style="color:var(--accent); text-decoration:none;">🎬 Відео</a>
                </div>
                ${ev ? `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:0.75rem;">
                    <div style="background:rgba(99,102,241,0.08); border-radius:10px; padding:0.75rem; text-align:center;">
                        <div style="font-size:0.75rem; color:var(--text-muted);">🔧 Тех. частина</div>
                        <div style="font-size:1.6rem; font-weight:700;">${ts}</div>
                    </div>
                    <div style="background:rgba(99,102,241,0.08); border-radius:10px; padding:0.75rem; text-align:center;">
                        <div style="font-size:0.75rem; color:var(--text-muted);">⚡ Функціонал</div>
                        <div style="font-size:1.6rem; font-weight:700;">${fs}</div>
                    </div>
                </div>
                ${note ? `<p style="color:var(--text-muted); font-size:0.85rem; margin-top:0.75rem;">💬 ${note}</p>` : ''}` : ''}
            </div>`;

        return `
        <div class="card animate-fade ${ev ? 'card-evaluated' : ''}">
            ${ev ? '<div class="evaluated-badge">✓ Оцінено</div>' : ''}
            <h3>${s.teamName}</h3>
            <p style="color:var(--text-muted); font-size:0.85rem;">📍 ${s.roundName}</p>
            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:0.5rem;">${s.description || 'Опис відсутній'}</p>
            <div style="margin:0.75rem 0; display:flex; gap:1.5rem;">
                <a href="${s.githubUrl}" target="_blank" style="color:var(--accent); text-decoration:none;">🔗 GitHub</a>
                <a href="${s.videoUrl}"  target="_blank" style="color:var(--accent); text-decoration:none;">🎬 Відео</a>
            </div>
            <hr style="margin:1rem 0; border-color:var(--glass-border);">
            <form onsubmit="evaluateSubmission(event,${s.id})">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>🔧 Тех. частина (0–100)</label><input type="number" min="0" max="100" required value="${ev ? ev.techScore : ''}"></div>
                    <div><label>⚡ Функціонал (0–100)</label><input type="number" min="0" max="100" required value="${ev ? ev.functionalityScore : ''}"></div>
                </div>
                <label>💬 Коментар</label>
                <input type="text" placeholder="Ваш відгук..." value="${note}">
                <button type="submit" class="btn" style="width:100%; ${ev ? 'border:1px solid #10b981;' : ''}">${ev ? 'Оновити оцінку' : 'Оцінити'}</button>
            </form>
        </div>`;
    }).join('');
}

async function evaluateSubmission(e, submissionId) {
    e.preventDefault();
    const btn    = e.target.querySelector('button[type="submit"]');
    const inputs = e.target.querySelectorAll('input');
    await api('/api/evaluations', 'POST', {
        submissionId,
        techScore:          parseInt(inputs[0].value),
        functionalityScore: parseInt(inputs[1].value),
        comment:            inputs[2].value
    });
    btn.innerText = '✓ Збережено';
    btn.style.background = '#10b981'; btn.style.border = '1px solid #10b981';
    setTimeout(() => { btn.innerText = 'Оновити оцінку'; btn.style.background = ''; btn.style.border = '1px solid #10b981'; }, 1500);
}

// Запуск ініціалізації додатка
initAuth().then(() => loadTournaments());
