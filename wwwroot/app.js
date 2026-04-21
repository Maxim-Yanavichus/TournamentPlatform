// ─── Глобальний стан додатка ─────────────────────────────────────────────────
let currentRole = localStorage.getItem('userRole') || 'Guest';
let myTeamId = localStorage.getItem('teamId');
let authToken = localStorage.getItem('authToken');
let username = localStorage.getItem('username');

let tournaments = [];
let currentTournamentId = null;
let currentJuryTournamentId = null;
let pendingMembers = [];

// ─── Взаємодія з API ─────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    
    const res = await fetch(path, opts);
    if (res.status === 401) { logout(); throw new Error('Потрібна авторизація'); }
    if (res.status === 403) { throw new Error('Недостатньо прав доступу'); }
    
    if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).message; } catch { }
        throw new Error(msg || 'Помилка сервера');
    }
    return res.json();
}

// ─── Авторизація та профілі ──────────────────────────────────────────────────
async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    
    try {
        const res = await api('/api/auth/login', 'POST', { username: u, password: p });
        localStorage.setItem('authToken', res.token);
        localStorage.setItem('userRole', res.role);
        localStorage.setItem('username', res.username);
        if (res.teamId) localStorage.setItem('teamId', res.teamId);
        
        authToken = res.token;
        currentRole = res.role;
        username = res.username;
        myTeamId = res.teamId;
        
        updateUIForAuth();
        showView('tournaments');
    } catch (err) {
        alert('❌ Помилка входу: ' + err.message);
    }
}

function logout() {
    localStorage.clear();
    authToken = null;
    currentRole = 'Guest';
    username = null;
    myTeamId = null;
    updateUIForAuth();
    showView('tournaments');
}

function updateUIForAuth() {
    const userInfo = document.getElementById('user-info');
    const btnLogin = document.getElementById('btn-login-view');
    const btnLogout = document.getElementById('btn-logout');
    
    if (authToken) {
        userInfo.textContent = `${username} (${currentRole})`;
        btnLogin.classList.add('hidden');
        btnLogout.classList.remove('hidden');
    } else {
        userInfo.textContent = 'Гість';
        btnLogin.classList.remove('hidden');
        btnLogout.classList.add('hidden');
    }
    
    document.body.className = `role-${currentRole.toLowerCase()}`;
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', currentRole !== 'Admin'));
    document.querySelectorAll('.team-only').forEach(el => el.classList.toggle('hidden', currentRole !== 'Team'));
    document.querySelectorAll('.jury-only').forEach(el => el.classList.toggle('hidden', currentRole !== 'Jury'));
}

// ─── Керування списком учасників команди ─────────────────────────────────────
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

// ─── Управління інтерфейсом ──────────────────────────────────────────────────
function showView(viewId) {
    document.querySelectorAll('main > div').forEach(d => d.classList.add('hidden'));
    const view = document.getElementById(`view-${viewId}`);
    if (view) view.classList.remove('hidden');
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
const sIcon  = s => STATUS_ICON[s] || '';

// ─── Список турнірів ─────────────────────────────────────────────────────────
async function loadTournaments() {
    try {
        tournaments = await api('/api/tournaments');
        const wrap = document.getElementById('tournament-list');
        if (!tournaments.length) {
            wrap.innerHTML = `<div class="empty-state"><div style="font-size:3rem;">🏆</div><p>Турнірів ще немає.</p></div>`;
            return;
        }
        wrap.innerHTML = tournaments.map(t => `
            <div class="card tournament-card animate-fade ${t.status === 'Finished' ? 'card-finished' : ''}">
                <div>
                    <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                        <span class="status-badge status-${t.status.toLowerCase()}">${sIcon(t.status)} ${sLabel(t.status)}</span>
                        ${t.status === 'Finished' ? '<span style="color:#9ca3af; font-size:0.8rem;">· Закрито</span>' : ''}
                    </div>
                    <h2>${t.name}</h2>
                    <p style="color:var(--text-muted); margin-bottom:1rem;">${(t.description||'').slice(0,120)}${(t.description||'').length>120?'...':''}</p>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn" onclick="openTournament(${t.id})">Відкрити</button>
                    <button class="btn btn-secondary" onclick="loadLeaderboard(${t.id})">📊 Таблиця</button>
                    <button class="btn jury-only hidden" onclick="openJuryView(${t.id})" style="border:1px solid var(--accent);">⚖️ Оцінити</button>
                </div>
            </div>`).join('');
    } catch (err) {
        console.error(err);
    }
}

function showCreateTournament() { showView('create-tournament'); }

document.getElementById('form-create-tournament').onsubmit = async e => {
    e.preventDefault();
    try {
        await api('/api/tournaments', 'POST', {
            name: document.getElementById('t-name').value,
            description: document.getElementById('t-desc').value,
            registrationStart: document.getElementById('t-reg-start').value || new Date().toISOString(),
            registrationEnd:   document.getElementById('t-reg-end').value   || new Date().toISOString(),
            maxTeams:    document.getElementById('t-max-teams').value ? parseInt(document.getElementById('t-max-teams').value) : null,
            resultsDate: document.getElementById('t-results-date').value ? new Date(document.getElementById('t-results-date').value).toISOString() : null,
            status: 'Registration'
        });
        showView('tournaments');
    } catch (err) { alert('❌ ' + err.message); }
};

// ─── Деталі турніру ──────────────────────────────────────────────────────────
async function openTournament(id) {
    currentTournamentId = id;
    try {
        const t = (await api('/api/tournaments')).find(x => x.id === id);
        if (!t) return;
        
        const isFinished = t.status === 'Finished';
        const isEval     = t.status === 'Evaluation';
        const isRunning  = t.status === 'Running';
        const now        = new Date();
        const regEnd     = new Date(t.registrationEnd);
        const regExpired = regEnd < now;

        const extra = [];
        if (t.maxTeams)    extra.push(`👥 Макс. команд: ${t.maxTeams}`);
        if (t.resultsDate) extra.push(`🏆 Оголошення: ${new Date(t.resultsDate).toLocaleDateString('uk-UA')}`);

        document.getElementById('details-content').innerHTML = `
            <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem; flex-wrap:wrap;">
                <span class="status-badge status-${t.status.toLowerCase()}">${sIcon(t.status)} ${sLabel(t.status)}</span>
                <h1 style="margin:0;">${t.name}</h1>
            </div>
            <p style="color:var(--text-muted);">${t.description || ''}</p>
            <div style="margin-top:0.75rem; color:var(--text-muted); font-size:0.85rem; display:flex; flex-wrap:wrap; gap:1.25rem;">
                <span>📅 Реєстрація до: <strong style="color:${regExpired?'#ef4444':'inherit'}">${regEnd.toLocaleDateString('uk-UA')}</strong></span>
                ${extra.map(s => `<span>${s}</span>`).join('')}
            </div>`;

        // Реєстрація команд (публічна або для Guest/Team)
        const regWrap = document.getElementById('team-registration');
        if (t.status === 'Registration') {
            regWrap.classList.remove('hidden');
            if (myTeamId) {
                regWrap.innerHTML = `<div class="success-banner">✅ Ваша команда вже зареєстрована.</div>`;
            } else if (regExpired) {
                regWrap.innerHTML = `<div class="status-full-banner banner-finished">⌛ Реєстрація закрита.</div>`;
            } else {
                pendingMembers = [];
                regWrap.innerHTML = `
                    <hr style="margin:2rem 0; border:none; border-top:1px solid var(--glass-border);">
                    <h3>Реєстрація Команди</h3>
                    <form id="form-team-reg">
                        <input type="text" placeholder="Назва команди (буде логіном)" id="reg-team-name" required>
                        <input type="text" placeholder="Капітан (ПІБ)" id="reg-captain-name" required>
                        <input type="email" placeholder="Email капітана" id="reg-captain-email" required>
                        <div id="members-list"></div>
                        <button type="button" id="add-member-btn" onclick="addMemberInput()" class="btn btn-secondary" style="width:100%; margin-bottom:1rem;">+ Додати учасника (0/10)</button>
                        <button type="submit" class="btn">Зареєструватися</button>
                    </form>`;
                document.getElementById('form-team-reg').onsubmit = handleTeamRegistration;
            }
        } else { regWrap.classList.add('hidden'); }

        // Керування адміном
        renderAdminControls(t);
        
        // Подача команд
        const teamWrap = document.getElementById('team-controls');
        teamWrap.classList.toggle('hidden', currentRole !== 'Team');
        if (currentRole === 'Team') loadActiveRounds(id, isFinished, isEval, t.status === 'Registration');

        showView('tournament-details');
        loadAnnouncements(id);
    } catch (err) { console.error(err); }
}

function renderAdminControls(t) {
    const adminWrap = document.getElementById('admin-controls');
    adminWrap.classList.toggle('hidden', currentRole !== 'Admin');
    if (currentRole !== 'Admin') return;

    const STEPS = [
        { key: 'Registration', icon: '📋', label: 'Реєстрація', desc: 'Прийом команд.', nextLabel: 'Розпочати турнір →', nextKey: 'Running', warn: 'Нові реєстрації будуть закриті.' },
        { key: 'Running',      icon: '🏃', label: 'Триває',     desc: 'Подача робіт.', nextLabel: 'До оцінювання →', nextKey: 'Evaluation', warn: 'Подача робіт буде закрита.' },
        { key: 'Evaluation',   icon: '⚖️', label: 'Оцінювання', desc: 'Журі працює.', nextLabel: 'Завершити →', nextKey: 'Finished', warn: 'Дія незворотна.' },
        { key: 'Finished',     icon: '🏁', label: 'Завершено',  desc: 'Турнір закрито.', nextLabel: null },
    ];
    const idx = STEPS.findIndex(s => s.key === t.status);
    const cur = STEPS[idx] || STEPS[0];
    const next = cur.nextLabel ? STEPS[idx+1] : null;

    adminWrap.innerHTML = `
        <h3>Керування етапами</h3>
        <div class="stage-info-box"><div><strong>${cur.label}</strong>: ${cur.desc}</div></div>
        ${next ? `<button class="btn" onclick="advanceStage(${t.id},'${next.key}',\`${cur.warn}\`)">${next.nextLabel}</button>` : ''}
        <button class="btn btn-secondary" onclick="showCreateRound()" style="margin-top:1rem;">+ Додати Раунд</button>
        <div id="round-list" style="margin-top:1rem;"></div>`;
    loadRounds(t.id);
}

async function advanceStage(id, newStatus, warn) {
    if (!confirm(`⚠️ ${warn}\n\nПродовжити?`)) return;
    try {
        await api(`/api/tournaments/${id}/status?status=${newStatus}`, 'PATCH');
        openTournament(id);
    } catch (err) { alert(err.message); }
}

async function handleTeamRegistration(e) {
    e.preventDefault();
    const name = document.getElementById('reg-team-name').value.trim();
    const members = pendingMembers.map(m => `${m.name} <${m.email}>`).join(', ');
    try {
        await api('/api/teams', 'POST', {
            tournamentId: currentTournamentId,
            name: name,
            captainName:  document.getElementById('reg-captain-name').value,
            captainEmail: document.getElementById('reg-captain-email').value,
            members: members
        });
        alert(`✅ Успіх! Тепер увійдіть у систему за назвою команди: ${name}\nПароль за замовчуванням: 123`);
        showView('login');
    } catch (err) { alert(err.message); }
}

// ─── Раунди та Подачі ────────────────────────────────────────────────────────
async function loadRounds(tournamentId) {
    const rounds = await api(`/api/rounds/${tournamentId}`);
    document.getElementById('round-list').innerHTML = rounds.map(r => `
        <div style="padding:0.5rem; background:rgba(255,255,255,0.05); margin-bottom:0.4rem; border-radius:8px;">
            <strong>${r.name}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">Дедлайн: ${new Date(r.deadline).toLocaleString('uk-UA')}</span>
        </div>`).join('') || 'Раундів немає';
}

function showCreateRound() {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,16);
    const name = prompt('Назва раунду:');
    if (!name) return;
    const dl = prompt('Дедлайн (YYYY-MM-DD HH:MM):', tomorrow.replace('T', ' '));
    if (!dl) return;
    api('/api/rounds', 'POST', { 
        tournamentId: currentTournamentId, name, deadline: new Date(dl).toISOString() 
    }).then(() => loadRounds(currentTournamentId));
}

async function loadActiveRounds(tournamentId, locked, editOnly, regStage) {
    const rounds = await api(`/api/rounds/${tournamentId}`);
    const wrap   = document.getElementById('active-rounds-for-submission');
    if (regStage) { wrap.innerHTML = '<p>Подача почнеться після реєстрації.</p>'; return; }
    
    const mySubs = (await api(`/api/submissions?tournamentId=${tournamentId}`)).filter(s => +s.teamId === +myTeamId);
    
    wrap.innerHTML = rounds.map(r => {
        const sub = mySubs.find(s => +s.roundId === +r.id);
        const expired = new Date(r.deadline) < new Date();
        
        if (sub) return `<div class="card card-submitted"><h4>${r.name} ✅</h4><button class="btn btn-secondary" onclick="editSub(${r.id},'${sub.githubUrl}')" ${expired?'disabled':''}>Змінити</button></div>`;
        return `<div class="card"><h4>${r.name}</h4><form onsubmit="submitWork(event,${r.id})"><input placeholder="GitHub URL" required><button class="btn" ${expired?'disabled':''}>Здати</button></form></div>`;
    }).join('') || 'Раундів немає';
}

async function submitWork(e, roundId) {
    e.preventDefault();
    const url = e.target.querySelector('input').value;
    try {
        await api('/api/submissions', 'POST', { roundId, teamId: parseInt(myTeamId), githubUrl: url });
        loadActiveRounds(currentTournamentId);
    } catch (err) { alert(err.message); }
}

// ─── Оголошення, Таблиця лідерів та Журі ──────────────────────────────────────
async function loadAnnouncements(tournamentId) {
    const sec = document.getElementById('announcements-section');
    const anns = await api(`/api/announcements/${tournamentId}`);
    const isAdmin = currentRole === 'Admin';
    sec.innerHTML = `<h4>📢 Оголошення</h4>` + (isAdmin ? `<textarea id="ann-text" placeholder="Нове оголошення..."></textarea><button onclick="postAnn(${tournamentId})">Надіслати</button>` : '') +
        anns.map(a => `<div class="announcement-card">${a.content}<br><small>${new Date(a.createdAt).toLocaleString()}</small></div>`).join('');
}

async function postAnn(id) {
    const content = document.getElementById('ann-text').value;
    await api('/api/announcements', 'POST', { tournamentId: id, content });
    loadAnnouncements(id);
}

async function loadLeaderboard(id) {
    const data = await api(`/api/leaderboard/${id}`);
    document.getElementById('leaderboard-body').innerHTML = data.map((r, i) => `<tr><td>${i+1}</td><td>${r.name}</td><td>${r.score.toFixed(1)}</td></tr>`).join('');
    showView('leaderboard');
}

async function loadJurySubmissions() {
    const subs = await api(`/api/submissions` + (currentJuryTournamentId ? `?tournamentId=${currentJuryTournamentId}` : ''));
    document.getElementById('submissions-to-evaluate').innerHTML = subs.map(s => `
        <div class="card">
            <h3>${s.teamName}</h3>
            <p>${s.roundName}</p>
            <a href="${s.githubUrl}" target="_blank">GitHub</a>
            <input type="number" id="sc-${s.id}" placeholder="Бал (0-100)">
            <button onclick="evalSub(${s.id})">Оцінити</button>
        </div>`).join('');
}

async function evalSub(subId) {
    const score = document.getElementById(`sc-${subId}`).value;
    await api('/api/evaluations', 'POST', { submissionId: subId, techScore: parseInt(score), functionalityScore: parseInt(score) });
    alert('Оцінено!');
}

// ─── Ініціалізація ───────────────────────────────────────────────────────────
document.getElementById('form-login').onsubmit = handleLogin;
updateUIForAuth();
loadTournaments();
