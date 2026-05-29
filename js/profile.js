let remoteProfile = null;
let socialDirectory = { directory: [], connections: [] };
let activePeerId = '';
let activeMessages = [];
let currentStudentId = '';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PPT_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
let profileAutoSaveTimer = null;
const AUTO_CHECK_PREFIX = '[AUTO_CHECK] ';

function formatDate(value) {
    if (!value) return 'Not yet';
    return new Date(value).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function formatBytes(bytes) {
    const parsed = Number(bytes);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = parsed;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function splitDescriptionAndAutoCheck(rawDescription) {
    const value = String(rawDescription || '');
    const markerIndex = value.lastIndexOf(AUTO_CHECK_PREFIX);
    if (markerIndex === -1) return { description: value, autoCheck: null };
    const description = value.slice(0, markerIndex).trim();
    const rawMeta = value.slice(markerIndex + AUTO_CHECK_PREFIX.length).trim();
    try {
        return { description, autoCheck: JSON.parse(rawMeta) };
    } catch (_error) {
        return { description: value, autoCheck: null };
    }
}

function getStudentLabel() {
    return window.ACADEMY.getStudentName() || 'Student';
}

function getRemoteStudent() {
    return remoteProfile && remoteProfile.student ? remoteProfile.student : {};
}

function getProfileValue(key) {
    const student = getRemoteStudent();
    return student[key] || '';
}

function renderProfilePage() {
    const stats = window.ACADEMY.calculateStats();
    const studentName = getStudentLabel();
    const recentTopics = window.ACADEMY.getRecentTopics();
    const bookmarks = window.ACADEMY.getBookmarkedTopics();
    const sessions = window.ACADEMY.getPracticeSessions();
    const syncMeta = window.ACADEMY.getRemoteSyncStamp();
    const remoteStudent = getRemoteStudent();
    const uploads = remoteProfile && Array.isArray(remoteProfile.uploads) ? remoteProfile.uploads : [];

    document.getElementById('profileHero').innerHTML = `
        <div>
            <p class="revision-label">Personal progress</p>
            <h2 class="text-3xl font-extrabold text-white">${studentName}'s learning cockpit</h2>
            <p class="text-slate-400 mt-2">Track completed topics, keep a neat academic identity, save solved material, and make this page feel like a study profile instead of a settings dump.</p>
        </div>
        <div class="profile-hero-actions">
            <input id="profileNameInput" class="search-input profile-name-input" value="${window.ACADEMY.escapeForAttribute(studentName)}" placeholder="Student name">
        </div>
    `;

    document.getElementById('profileStats').innerHTML = `
        <article class="metric-card"><p class="metric-label">Completion</p><div class="metric-value">${stats.completionRate}%</div><p class="metric-subtext">${stats.completedTopics}/${stats.totalTopics} topics covered</p></article>
        <article class="metric-card"><p class="metric-label">Accuracy</p><div class="metric-value">${stats.quizAccuracy}%</div><p class="metric-subtext">${stats.correctAnswers}/${stats.totalAttempts} quiz answers correct</p></article>
        <article class="metric-card"><p class="metric-label">Bookmarks</p><div class="metric-value">${bookmarks.length}</div><p class="metric-subtext">Saved weak or important topics</p></article>
        <article class="metric-card"><p class="metric-label">Study vault</p><div class="metric-value">${uploads.filter((item) => item.upload_kind === 'study-pdf').length}</div><p class="metric-subtext">Uploaded solved PDFs</p></article>
    `;

    document.getElementById('profileIdentity').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Student identity</h3>
                <span>Optional details</span>
            </div>
            <div class="grid md:grid-cols-[160px_minmax(0,1fr)] gap-5">
                <div class="space-y-4">
                    <div class="avatar-shell">
                        ${remoteStudent.avatar_url ? `<img src="${remoteStudent.avatar_url}" alt="${studentName}" class="avatar-image">` : `<span>${studentName.slice(0, 1).toUpperCase()}</span>`}
                    </div>
                    <input id="avatarUploadInput" type="file" accept="image/png,image/jpeg,image/webp" class="search-input">
                    <button id="uploadAvatarBtn" class="secondary-cta w-full justify-center">Upload avatar</button>
                </div>
                <div class="space-y-4">
                    <input id="profileHeadlineInput" class="search-input" placeholder="Headline, for example: CN revision sprinter and ML model tinkerer" value="${window.ACADEMY.escapeForAttribute(remoteStudent.headline || '')}">
                    <textarea id="profileBioInput" class="note-input !min-h-[9rem]" placeholder="Short intro, strengths, or what you are currently revising...">${window.ACADEMY.escapeHtml(remoteStudent.bio || '')}</textarea>
                    <div class="grid md:grid-cols-2 gap-4">
                        <input id="profileEmailInput" class="search-input" placeholder="Email (optional)" value="${window.ACADEMY.escapeForAttribute(remoteStudent.email || '')}">
                        <input id="profileGithubInput" class="search-input" placeholder="GitHub URL" value="${window.ACADEMY.escapeForAttribute(remoteStudent.github_url || '')}">
                        <input id="profileLinkedinInput" class="search-input" placeholder="LinkedIn URL" value="${window.ACADEMY.escapeForAttribute(remoteStudent.linkedin_url || '')}">
                        <input id="profileWebsiteInput" class="search-input" placeholder="Website / portfolio URL" value="${window.ACADEMY.escapeForAttribute(remoteStudent.website_url || '')}">
                    </div>
                    <div class="flex flex-wrap gap-3">
                        <span class="metric-subtext">Optional profile details for classmates and collaborators.</span>
                    </div>
                </div>
            </div>
        </section>
    `;

    document.getElementById('profileCloud').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Study profile overview</h3>
                <span>${remoteProfile ? 'Connected' : 'Preparing'}</span>
            </div>
            <div class="space-y-4">
                <div class="status-chip status-${syncMeta.lastStatus || 'local-only'}">${remoteProfile ? 'Saved automatically' : 'Local study mode'}</div>
                <div class="summary-list">
                    <p><strong class="text-white">Last save:</strong> ${formatDate(syncMeta.lastSyncedAt)}</p>
                    <p><strong class="text-white">Saved notes:</strong> ${sessions.length ? 'Practice history recorded' : 'Start solving quizzes to build history'}</p>
                    <p><strong class="text-white">Profile status:</strong> ${syncMeta.lastMessage}</p>
                </div>
                ${remoteProfile ? `
                    <div class="study-rail-block !p-4">
                        <p class="metric-label">Quick snapshot</p>
                        <p class="text-sm text-slate-400 mt-2">${remoteProfile.summary.completed_topics || 0} completed topics â€¢ ${remoteProfile.summary.attempts_count || 0} quiz attempts â€¢ ${remoteProfile.summary.connections_count || 0} study connections â€¢ ${remoteProfile.summary.direct_messages_count || 0} messages received</p>
                    </div>
                ` : '<p class="text-sm text-slate-400">Your details are stored quietly as you study. Once the deployed app connects, this page fills itself in automatically.</p>'}
            </div>
        </section>
    `;

    document.getElementById('profileBreakdown').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Course coverage</h3>
                <span>Per-subject progress</span>
            </div>
            <div class="space-y-4">
                ${window.coursesData.map((course) => {
                    const courseStats = stats.courseStats[course.id] || { completed: 0, total: 0, completionRate: 0 };
                    return `
                        <div class="progress-row">
                            <div class="flex items-center justify-between gap-4">
                                <strong class="text-white">${course.code}</strong>
                                <span class="metric-subtext">${courseStats.completed}/${courseStats.total} topics</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-bar-fill" style="width:${courseStats.completionRate}%"></div>
                            </div>
                            <p class="text-sm text-slate-400 mt-2">${course.title}</p>
                        </div>
                    `;
                }).join('')}
            </div>
        </section>
    `;

    document.getElementById('profileAssets').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Study vault</h3>
                <span>PDF/PPT upload for solved material</span>
            </div>
            <div class="space-y-4">
                <div class="grid md:grid-cols-[1fr_1fr] gap-4">
                    <input id="pdfTitleInput" class="search-input" placeholder="Title, for example: CN unit 3 solved answers">
                    <input id="pdfDescriptionInput" class="search-input" placeholder="Short note or description">
                </div>
                <input id="pdfUploadInput" type="file" accept="application/pdf,.pdf,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx" class="search-input">
                <div class="flex flex-wrap gap-3 items-center">
                    <button id="uploadPdfBtn" class="primary-cta">Upload solved file</button>
                    <span class="metric-subtext">PDF: 10 MB, PPT/PPTX: 25 MB</span>
                </div>
                <div class="space-y-3">
                    ${uploads.length ? uploads.map((upload) => {
                        const parsedMeta = splitDescriptionAndAutoCheck(upload.description);
                        const autoCheck = parsedMeta.autoCheck;
                        const autoCheckLabel = autoCheck && autoCheck.status
                            ? (autoCheck.status === 'likely-correct'
                                ? `Keyword check: likely correct (${autoCheck.score || 0}%)`
                                : autoCheck.status === 'needs-review'
                                    ? `Keyword check: needs review (${autoCheck.score || 0}%)`
                                    : autoCheck.status === 'error'
                                        ? 'Keyword check: unavailable'
                                        : 'Keyword check: skipped')
                            : '';
                        return `
                        <article class="social-card">
                            <div class="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <strong class="text-white">${upload.title}</strong>
                                    <p class="text-sm text-slate-400 mt-2">${parsedMeta.description || (upload.upload_kind === 'avatar' ? 'Profile image' : 'Solved study material')}</p>
                                    ${autoCheckLabel ? `<p class="text-xs text-cyan-300 mt-2">${autoCheckLabel}</p>` : ''}
                                    <p class="text-xs text-slate-500 mt-2">${formatBytes(upload.size_bytes)} • ${formatDate(upload.uploaded_at)}</p>
                                </div>
                                <a href="${upload.download_url || upload.blob_url}" target="_blank" rel="noreferrer" class="secondary-cta text-sm !py-2 !px-4">Open</a>
                            </div>
                        </article>
                    `;
                    }).join('') : '<p class="text-slate-400">No uploads yet. Add solved PDFs, answer sheets, or compact revision notes here.</p>'}
                </div>
            </div>
        </section>
    `;

    document.getElementById('profileRecent').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Recent topics</h3>
                <span>Continue faster</span>
            </div>
            <div class="space-y-3">
                ${recentTopics.length ? recentTopics.slice(0, 8).map((topic) => `
                    <a href="../index.html" class="continue-card block">
                        <p class="metric-label">${topic.courseCode} â€¢ Unit ${topic.unitNumber}</p>
                        <h4 class="text-lg font-bold text-white mt-2">${topic.title}</h4>
                    </a>
                `).join('') : '<p class="text-slate-400">Open a few topics from the curriculum and they will start appearing here.</p>'}
            </div>
        </section>
    `;

    document.getElementById('profileHistory').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Practice history</h3>
                <span>Latest scores</span>
            </div>
            <div class="space-y-3">
                ${sessions.length ? sessions.slice(0, 8).map((session) => `
                    <div class="study-rail-block !p-4">
                        <strong class="text-white">${session.courseLabel}</strong>
                        <p class="text-sm text-slate-400 mt-2">${session.correct}/${session.total} correct â€¢ ${session.accuracy}% â€¢ ${session.mode}</p>
                        <p class="text-xs text-slate-500 mt-2">${formatDate(session.finishedAt)}</p>
                    </div>
                `).join('') : '<p class="text-slate-400">No mock history yet. Complete a drill or timed mock from the tests page.</p>'}
            </div>
        </section>
    `;

    renderStudentDirectory();
    renderInbox();
    bindProfileActions();
}

function renderStudentDirectory() {
    const connectedIds = new Set((socialDirectory.connections || []).map((student) => student.id));
    document.getElementById('profileStudents').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Student network</h3>
                <span>${(socialDirectory.connections || []).length} linked</span>
            </div>
            <div class="space-y-3">
                ${(socialDirectory.directory || []).length ? socialDirectory.directory.map((student) => `
                    <div class="social-card">
                        <div class="flex items-start gap-4">
                            <div class="avatar-shell avatar-shell-small">
                                ${student.avatar_url ? `<img src="${student.avatar_url}" alt="${student.display_name}" class="avatar-image">` : `<span>${student.display_name.slice(0, 1).toUpperCase()}</span>`}
                            </div>
                            <div class="flex-1">
                                <strong class="text-white">${student.display_name}</strong>
                                <p class="text-sm text-slate-400 mt-1">${student.headline || 'Studying, revising, and doing the brave academic thing.'}</p>
                                <p class="text-sm text-slate-400 mt-2">${student.bio || 'Available for revision chats, shared notes, and surviving unit tests together.'}</p>
                                <p class="text-xs text-slate-500 mt-2">Seen ${formatDate(student.last_seen_at)}</p>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 mt-3">
                            <button onclick="connectStudent('${student.id}')" class="secondary-cta text-sm !py-2 !px-4" ${student.connected ? 'disabled' : ''}>
                                ${student.connected ? 'Connected' : 'Connect'}
                            </button>
                            <button onclick="openMessageThread('${student.id}')" class="primary-cta text-sm !py-2 !px-4">
                                ${connectedIds.has(student.id) ? 'Open DM' : 'Message'}
                            </button>
                            <button onclick="reportStudent('${student.id}', '${window.ACADEMY.escapeForAttribute(student.display_name)}')" class="secondary-cta text-sm !py-2 !px-4">Report</button>
                        </div>
                    </div>
                `).join('') : '<p class="text-slate-400">As more students start using the deployed portal, their profiles will appear here automatically.</p>'}
            </div>
        </section>
    `;
}

function renderInbox() {
    const peer = (socialDirectory.directory || []).find((student) => student.id === activePeerId)
        || (socialDirectory.connections || []).find((student) => student.id === activePeerId);

    document.getElementById('profileInbox').innerHTML = `
        <section class="panel-card p-5">
            <div class="section-head">
                <h3>Direct messages</h3>
                <span>${peer ? peer.display_name : 'Pick a student'}</span>
            </div>
            <div class="chat-thread chat-thread-whatsapp mb-4">
                ${activeMessages.length ? activeMessages.map((message) => `
                    <article class="chat-message chat-bubble ${message.sender_id === currentStudentId ? 'chat-bubble-own' : 'chat-bubble-peer'}">
                        <strong class="text-white">${message.sender_id === currentStudentId ? 'You' : message.sender_name}</strong>
                        <p class="text-sm text-slate-400 mt-2">${message.message_text}</p>
                        <p class="text-xs text-slate-500 mt-2">${formatDate(message.created_at)}</p>
                    </article>
                `).join('') : '<p class="text-slate-400">Choose a student from the directory to open a simple DM thread.</p>'}
            </div>
            <div class="space-y-3">
                <textarea id="dmInput" class="note-input !min-h-[6rem]" placeholder="Write a revision doubt, study invite, or one calm message before the semester attacks again."></textarea>
                <button id="sendDmBtn" class="primary-cta ${peer ? '' : 'opacity-60 pointer-events-none'}">Send</button>
            </div>
        </section>
    `;
}

function bindProfileActions() {
    bindClick('sendDmBtn', sendDirectMessage);
    bindClick('uploadAvatarBtn', uploadAvatar);
    bindClick('uploadPdfBtn', uploadStudyPdf);
    bindProfileAutosave();
}

function bindClick(id, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('click', handler);
    }
}

function collectProfilePayload() {
    return {
        headline: document.getElementById('profileHeadlineInput').value.trim(),
        bio: document.getElementById('profileBioInput').value.trim(),
        email: document.getElementById('profileEmailInput').value.trim(),
        githubUrl: document.getElementById('profileGithubInput').value.trim(),
        linkedinUrl: document.getElementById('profileLinkedinInput').value.trim(),
        websiteUrl: document.getElementById('profileWebsiteInput').value.trim()
    };
}

async function saveProfileDetails() {
    if (window.location.protocol === 'file:') return;
    const displayName = document.getElementById('profileNameInput').value.trim() || getStudentLabel();
    window.ACADEMY.setStudentName(displayName);

    await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            deviceId: window.ACADEMY.state.deviceId,
            displayName,
            snapshot: window.ACADEMY.exportStudentSnapshot(),
            profile: collectProfilePayload()
        })
    });

    await hydrateRemoteProfile();
    renderProfilePage();
}

function queueProfileAutosave() {
    if (window.location.protocol === 'file:') return;
    clearTimeout(profileAutoSaveTimer);
    profileAutoSaveTimer = window.setTimeout(async () => {
        try {
            await saveProfileDetails();
            await hydrateRemoteProfile();
        } catch (error) {
            console.error('Unable to autosave profile details', error);
        }
    }, 1600);
}

function bindProfileAutosave() {
    [
        'profileNameInput',
        'profileHeadlineInput',
        'profileBioInput',
        'profileEmailInput',
        'profileGithubInput',
        'profileLinkedinInput',
        'profileWebsiteInput'
    ].forEach((id) => {
        const field = document.getElementById(id);
        if (!field) return;
        field.addEventListener('input', queueProfileAutosave);
        field.addEventListener('blur', queueProfileAutosave);
    });
}

async function hydrateRemoteProfile() {
    if (window.location.protocol === 'file:') return;

    try {
        const response = await fetch(`/api/profile?deviceId=${encodeURIComponent(window.ACADEMY.state.deviceId)}`);
        if (!response.ok) return;
        remoteProfile = await response.json();
        if (remoteProfile && remoteProfile.student && remoteProfile.student.avatar_url) {
            window.ACADEMY.setProfileAvatar(remoteProfile.student.avatar_url);
        }
    } catch (error) {
        console.error('Unable to load remote profile', error);
    }
}

async function hydrateStudentDirectory() {
    if (window.location.protocol === 'file:') return;

    try {
        const response = await fetch(`/api/social?deviceId=${encodeURIComponent(window.ACADEMY.state.deviceId)}`);
        if (!response.ok) return;
        socialDirectory = await response.json();
    } catch (error) {
        console.error('Unable to load student directory', error);
    }
}

async function connectStudent(targetStudentId) {
    try {
        await fetch('/api/social', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: window.ACADEMY.state.deviceId,
                targetStudentId
            })
        });
        await hydrateStudentDirectory();
        renderProfilePage();
    } catch (error) {
        console.error('Unable to connect student', error);
    }
}

async function openMessageThread(peerId) {
    activePeerId = peerId;
    try {
        const response = await fetch(`/api/messages?deviceId=${encodeURIComponent(window.ACADEMY.state.deviceId)}&peerId=${encodeURIComponent(peerId)}`);
        if (!response.ok) return;
        const payload = await response.json();
        activeMessages = payload.messages || [];
        currentStudentId = payload.currentStudentId || currentStudentId;
        renderProfilePage();
    } catch (error) {
        console.error('Unable to load messages', error);
    }
}

async function reportStudent(targetStudentId, studentName) {
    const reportReason = window.prompt(`Report ${studentName} for:`, 'Spam, abuse, fake account, or inappropriate behavior');
    if (!reportReason) return;

    try {
        await fetch('/api/report-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: window.ACADEMY.state.deviceId,
                targetStudentId,
                reportReason
            })
        });
        window.alert('Report sent to admin review.');
    } catch (error) {
        console.error('Unable to report student', error);
        window.alert('Unable to report this user right now.');
    }
}

async function sendDirectMessage() {
    const field = document.getElementById('dmInput');
    const messageText = field ? field.value.trim() : '';
    if (!activePeerId || !messageText) return;

    try {
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: window.ACADEMY.state.deviceId,
                recipientStudentId: activePeerId,
                messageText
            })
        });
        field.value = '';
        await openMessageThread(activePeerId);
    } catch (error) {
        console.error('Unable to send direct message', error);
    }
}

async function runBlobUpload(file, payload) {
    const appConfig = window.ACADEMY.getAppConfig();
    if (!appConfig.blobEnabled) {
        throw new Error('Blob uploads are not active on this deployment yet. Delete the old wrong token, keep only BLOB_READ_WRITE_TOKEN in Vercel, then redeploy once.');
    }

    const { upload } = await import('https://esm.sh/@vercel/blob@2.4.0/client');
    return upload(payload.pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
        multipart: file.size > 5 * 1024 * 1024,
        clientPayload: JSON.stringify(payload)
    });
}

async function uploadAvatar() {
    const input = document.getElementById('avatarUploadInput');
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
        alert('Avatar must be 2 MB or smaller.');
        return;
    }

    try {
        await saveProfileDetails();
        await runBlobUpload(file, {
            deviceId: window.ACADEMY.state.deviceId,
            uploadKind: 'avatar',
            originalName: file.name,
            title: `${getStudentLabel()} avatar`,
            description: 'Profile image',
            pathname: `students/${window.ACADEMY.state.deviceId}/avatars/${file.name}`
        });
        input.value = '';
        await hydrateRemoteProfile();
        if (remoteProfile && remoteProfile.student && remoteProfile.student.avatar_url) {
            window.ACADEMY.setProfileAvatar(remoteProfile.student.avatar_url);
        }
        renderProfilePage();
    } catch (error) {
        console.error('Unable to upload avatar', error);
        alert(error.message || 'Unable to upload avatar right now.');
    }
}

async function uploadStudyPdf() {
    const input = document.getElementById('pdfUploadInput');
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    const lowerName = String(file.name || '').toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isPpt = file.type === 'application/vnd.ms-powerpoint'
        || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        || lowerName.endsWith('.ppt')
        || lowerName.endsWith('.pptx');
    if (!isPdf && !isPpt) {
        alert('Upload only PDF, PPT, or PPTX.');
        return;
    }
    if (isPdf && file.size > MAX_PDF_BYTES) {
        alert('Solved PDF must be 10 MB or smaller.');
        return;
    }
    if (isPpt && file.size > MAX_PPT_BYTES) {
        alert('Solved PPT/PPTX must be 25 MB or smaller.');
        return;
    }

    const title = document.getElementById('pdfTitleInput').value.trim() || file.name.replace(/\.pdf$/i, '');
    const description = document.getElementById('pdfDescriptionInput').value.trim();

    try {
        await saveProfileDetails();
        await runBlobUpload(file, {
            deviceId: window.ACADEMY.state.deviceId,
            uploadKind: 'study-pdf',
            originalName: file.name,
            title,
            description,
            pathname: `students/${window.ACADEMY.state.deviceId}/study-pdfs/${file.name}`
        });
        input.value = '';
        document.getElementById('pdfTitleInput').value = '';
        document.getElementById('pdfDescriptionInput').value = '';
        await hydrateRemoteProfile();
        renderProfilePage();
    } catch (error) {
        console.error('Unable to upload study PDF', error);
        alert(error.message || 'Unable to upload solved PDF right now.');
    }
}

window.connectStudent = connectStudent;
window.openMessageThread = openMessageThread;
window.reportStudent = reportStudent;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await window.ACADEMY.requireStudentAuth({
        nextPath: '/html/profile.html'
    });
    if (!allowed) return;

    window.ACADEMY.scheduleCloudSync();
    renderProfilePage();
    await hydrateRemoteProfile();
    await hydrateStudentDirectory();
    currentStudentId = remoteProfile && remoteProfile.student ? remoteProfile.student.id : currentStudentId;
    renderProfilePage();
});


