import { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Check, ChevronRight, CircleUserRound, ExternalLink, FileText, LayoutDashboard, LoaderCircle, LogOut, RefreshCw, Search, Send, Settings2, Sparkles, X } from 'lucide-react';

type Job = { id: string; title: string; company?: string | null; location?: string | null; description?: string | null; url: string; contactEmail?: string | null; employmentType?: string | null; salary?: string | null; fitScore?: number | null; scoreDetails?: { matchedSkills?: string[]; missingSkills?: string[] } | null; postedAt?: string | null; deadline?: string | null };
type Application = { id: string; jobId: string; status: string; letter?: string | null; letterVersion: number; sentAt?: string | null; createdAt?: string; updatedAt?: string };
type DocumentItem = { id: string; name: string; documentType: string };
type Page = 'jobs' | 'applications' | 'profile' | 'job-detail';
const listValue = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : typeof value === 'string' ? value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) : [];

function RoleDescription({ text }: { text: string }) {
  const headingPattern = /(about the organisation|about the organization|the organisation|the organization|job description|key responsibilities|responsibilities|duties|requirements|qualifications|person specification|personal specification|skills and experience|experience and qualifications|education|how to apply|application procedure|application process|applications|benefits|position summary|job summary|terms of reference|what you will do|who you are)/i;
  const prepared = text
    .replace(/\s+(?=(about the organisation|about the organization|the organisation|the organization|job description|key responsibilities|responsibilities|duties|requirements|qualifications|person specification|personal specification|skills and experience|experience and qualifications|education|how to apply|application procedure|application process|benefits|position summary|job summary|terms of reference|what you will do|who you are)\s*:?\s)/gi, '\n\n## ')
    .replace(/\s+(?=\d+[.)]\s+)/g, '\n')
    .replace(/\s+(?=[•*]\s+)/g, '\n');
  const paragraphs = prepared.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return <div className="role-copy">{paragraphs.map((paragraph, index) => {
    const lines = paragraph.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const heading = paragraph.match(/^##\s*(.+?)(?:\s*:)?$/)?.[1]
      ?? (paragraph.length < 90 && !/[.!?]$/.test(paragraph) && headingPattern.test(paragraph) ? paragraph.replace(/:$/, '') : null)
      ?? (paragraph.length < 90 && paragraph === paragraph.toUpperCase() && /[A-Z]/.test(paragraph) ? paragraph : null);
    if (heading) return <h4 key={index}>{heading}</h4>;
    if (lines.length > 1 && lines.every((line) => /^(?:[-*•]|\d+[.)])\s*/.test(line))) {
      return <ul key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{line.replace(/^(?:[-*•]|\d+[.)])\s*/, '')}</li>)}</ul>;
    }
    return <p key={index}>{paragraph.replace(/\n/g, ' ')}</p>;
  })}</div>;
}

const api = async <T,>(path: string, token: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
};

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('jobsearch-token') ?? '');
  const [tokenInput, setTokenInput] = useState(token);
  const [page, setPage] = useState<Page>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [profileData, setProfileData] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [letter, setLetter] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [sendPreview, setSendPreview] = useState<{ recipient: string; subject: string; letter: string; documents: Array<{ id: string; name: string }>; letterVersion: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError('');
    try {
      const [jobData, appData, docData, profileData] = await Promise.all([
        api<{ jobs: Job[] }>('/jobs?limit=100', token),
        api<{ applications: Application[] }>('/applications', token),
        api<{ documents: DocumentItem[] }>('/documents', token),
        api<{ profile: unknown }>('/profile', token),
      ]);
      setJobs(jobData.jobs); setApplications(appData.applications); setDocuments(docData.documents);
      setProfileData((profileData.profile && typeof profileData.profile === 'object') ? profileData.profile as Record<string, unknown> : {});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load data'); }
    finally { setBusy(false); }
  }, [token]);

  useEffect(() => { void loadData(); }, [loadData]);
  const visibleJobs = useMemo(() => jobs.filter((job) => {
    const query = search.toLowerCase();
    const matchesSearch = !query || `${job.title} ${job.company ?? ''} ${job.location ?? ''}`.toLowerCase().includes(query);
    return matchesSearch && (minScore === '' || (job.fitScore ?? -1) >= Number(minScore));
  }), [jobs, search, minScore]);
  const applicationByJob = useMemo(() => new Map(applications.map((application) => [application.jobId, application])), [applications]);

  async function perform<T,>(path: string, options: RequestInit = {}) {
    setError(''); setNotice(''); setBusy(true);
    try { const result = await api<T>(path, token, options); await loadData(); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed'); return null; }
    finally { setBusy(false); }
  }

  async function scoreJob(job: Job) {
    const result = await perform<{ fitScore: number | null; matchedSkills: string[] }>(`/jobs/${job.id}/score`, { method: 'POST' });
    if (result) setNotice(`Match scored: ${result.fitScore ?? 'add skills to your profile'}${result.fitScore !== null ? '%' : ''}`);
  }
  async function draft(job: Job) {
    const result = await perform<{ application: Application; recommendedDocumentIds: string[] }>(`/jobs/${job.id}/draft`, { method: 'POST' });
    if (result) { setSelectedJob(job); setSelectedApp(result.application); setLetter(result.application.letter ?? ''); setSelectedDocs(result.recommendedDocumentIds); }
  }
  async function saveLetter() {
    if (!selectedApp) return;
    const result = await perform<{ application: Application }>(`/applications/${selectedApp.id}/letter`, { method: 'PATCH', body: JSON.stringify({ letter }) });
    if (result) setSelectedApp(result.application);
  }
  async function previewSend(application: Application) {
    const result = await perform<typeof sendPreview>(`/applications/${application.id}/send-preview`, { method: 'POST', body: JSON.stringify({ documentIds: selectedDocs }) });
    if (result) setSendPreview(result);
  }
  async function confirmSend() {
    if (!selectedApp || !sendPreview) return;
    const result = await perform<{ sent: boolean }>(`/applications/${selectedApp.id}/send-confirm`, {
      method: 'POST', body: JSON.stringify({ confirm: true, letterVersion: sendPreview.letterVersion, documentIds: selectedDocs }),
    });
    if (result) { setSendPreview(null); setNotice('Application sent successfully.'); }
  }
  async function saveProfile() {
    const profile = {
      ...profileData,
      skills: listValue(profileData.skills), preferredLocations: listValue(profileData.preferredLocations),
      seniority: listValue(profileData.seniority), roles: listValue(profileData.roles),
      education: listValue(profileData.education), referees: listValue(profileData.referees),
    };
    const result = await perform('/profile', { method: 'PUT', body: JSON.stringify(profile) });
    if (result) setNotice('Profile saved.');
  }
  async function importCv(file?: File) {
    if (!file) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const form = new FormData(); form.append('cv', file);
      const response = await fetch('/api/profile/import-cv', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'CV upload failed');
      const extracted = result.extractedProfile as Record<string, unknown>;
      setProfileData((current) => ({ ...current, ...extracted }));
      setNotice('CV read. Review the extracted details below, correct them, then save your profile.');
      await loadData();
      setProfileData((current) => ({ ...current, ...extracted }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'CV upload failed'); }
    finally { setBusy(false); }
  }
  function updateProfileField(field: string, value: string) {
    setProfileData((current) => ({ ...current, [field]: value }));
  }
  async function downloadLetterPdf(application: Application) {
    setError('');
    try {
      const response = await fetch(`/api/applications/${application.id}/letter.pdf`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Could not download letter PDF');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `application-${application.id}.pdf`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download letter PDF'); }
  }

  if (!token) return <main className="login-shell"><div className="login-card"><div className="brand-mark"><BriefcaseBusiness size={22} /></div><p className="eyebrow">YOUR PRIVATE WORKSPACE</p><h1>Welcome back.</h1><p className="muted">Enter your backend access token to manage your job search.</p><form onSubmit={(event) => { event.preventDefault(); localStorage.setItem('jobsearch-token', tokenInput); setToken(tokenInput); }}><label htmlFor="token">Access token</label><input id="token" type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="Paste your AUTH_TOKEN" required /><button className="primary wide">Continue <ChevronRight size={17} /></button></form><p className="tiny muted">If you haven't configured AUTH_TOKEN, leave it blank and continue.</p></div></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><BriefcaseBusiness size={20} /></span><span>MyJob<span className="brand-light">Scout</span></span></a>
      <p className="nav-caption">WORKSPACE</p>
      <nav>
        <button className={page === 'jobs' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('jobs')}><LayoutDashboard size={18} /> Discover jobs <span className="nav-count">{jobs.length}</span></button>
        <button className={page === 'applications' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('applications')}><Send size={18} /> Applications <span className="nav-count">{applications.length}</span></button>
        <button className={page === 'profile' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('profile')}><CircleUserRound size={18} /> My profile</button>
      </nav>
      <div className="sidebar-bottom"><div className="source-status"><span className="status-dot"/><span><b>Job Search Malawi</b><small>Source configured</small></span></div><button className="nav-item logout" onClick={() => { localStorage.removeItem('jobsearch-token'); setToken(''); }}><LogOut size={17}/> Sign out</button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><p className="eyebrow">TUESDAY, YOUR NEXT MOVE</p><h1>{page === 'jobs' ? 'Find your next opportunity' : page === 'applications' ? 'Application tracker' : page === 'profile' ? 'Your profile' : 'Job details'}</h1></div><button className="icon-button" title="Refresh" onClick={() => void loadData()}><RefreshCw size={18} className={busy ? 'spin' : ''}/></button></header>
      {error && <div className="alert error"><X size={17}/>{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      {notice && <div className="alert success"><Check size={17}/>{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
      {page === 'jobs' && <>
        <section className="welcome-card"><div><span className="welcome-icon"><Sparkles size={18}/></span><h2>A smarter search starts here.</h2><p>Review fresh opportunities, compare your skills, and build thoughtful applications.</p></div><div className="welcome-stat"><strong>{jobs.length}</strong><span>opportunities collected</span></div></section>
        <div className="toolbar"><div className="search-box"><Search size={18}/><input aria-label="Search jobs" placeholder="Search roles, companies, locations..." value={search} onChange={(event) => setSearch(event.target.value)}/></div><label className="score-filter"><Settings2 size={16}/><span>Score at least</span><select value={minScore} onChange={(event) => setMinScore(event.target.value)}><option value="">Any score</option><option value="50">50+</option><option value="70">70+</option><option value="85">85+</option></select></label></div>
        <div className="section-title"><div><h2>Recommended roles</h2><p>{visibleJobs.length} listings to explore</p></div><span className="sort-label">Newest first</span></div>
        <div className="job-list">{visibleJobs.map((job) => { const application = applicationByJob.get(job.id); return <article className="job-card" key={job.id}>
          <div className="company-logo">{(job.company ?? job.title).slice(0, 1).toUpperCase()}</div><div className="job-info"><div className="job-heading"><h3>{job.title}</h3>{job.fitScore !== null && job.fitScore !== undefined ? <span className={job.fitScore >= 70 ? 'score-badge high' : 'score-badge'}><Sparkles size={13}/>{job.fitScore}% match</span> : null}</div><div className="job-meta"><span>{job.company || 'Employer not listed'}</span><i/> <span>{job.location || 'Malawi'}</span>{job.postedAt && <><i/><span>{new Date(job.postedAt).toLocaleDateString()}</span></>}</div>
            {job.scoreDetails?.matchedSkills?.length ? <div className="skill-tags">{job.scoreDetails.matchedSkills.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div> : <p className="job-excerpt">{job.description?.slice(0, 160) || 'Open the listing to review the full role details.'}{(job.description?.length ?? 0) > 160 ? '…' : ''}</p>}
            <div className="job-actions"><button className="text-button" onClick={() => void scoreJob(job)}><Sparkles size={15}/> Score match</button><button className="text-button" onClick={() => { setSelectedJob(job); setPage('job-detail'); }}>View details <ChevronRight size={14}/></button>{application && <span className="application-pill">{application.status}</span>}</div>
          </div><button className="draft-button" onClick={() => void draft(job)}>{application ? 'Open draft' : 'Draft application'} <ChevronRight size={16}/></button>
        </article>; })}{visibleJobs.length === 0 && <div className="empty-state"><Search size={28}/><h3>No jobs match those filters</h3><p>Try a different search or clear the minimum score.</p></div>}</div>
      </>}
      {page === 'job-detail' && selectedJob && <section className="job-detail-page">
        <button className="back-link" onClick={() => setPage('jobs')}>← Back to jobs</button>
        <article className="job-detail-card"><div className="detail-top"><div className="company-logo detail-logo">{(selectedJob.company ?? selectedJob.title).slice(0, 1).toUpperCase()}</div><div><p className="eyebrow">JOB SEARCH MALAWI</p><h2>{selectedJob.title}</h2><p className="detail-company">{selectedJob.company || 'Employer not listed'} · {selectedJob.location || 'Malawi'}</p></div>{selectedJob.fitScore !== null && selectedJob.fitScore !== undefined && <span className="score-badge high"><Sparkles size={13}/>{selectedJob.fitScore}% match</span>}</div>
          <div className="detail-facts">{selectedJob.contactEmail && <div><small>APPLICATION CONTACT</small><span>{selectedJob.contactEmail}</span></div>}{selectedJob.employmentType && <div><small>EMPLOYMENT TYPE</small><span>{selectedJob.employmentType}</span></div>}{selectedJob.salary && <div><small>SALARY</small><span>{selectedJob.salary}</span></div>}{selectedJob.deadline && <div><small>DEADLINE</small><span>{new Date(selectedJob.deadline).toLocaleDateString()}</span></div>}</div>
          {selectedJob.scoreDetails?.matchedSkills?.length ? <div className="match-explanation"><b><Sparkles size={15}/> Why this matches</b><div className="skill-tags">{selectedJob.scoreDetails.matchedSkills.map((skill) => <span key={skill}>{skill}</span>)}</div>{selectedJob.scoreDetails.missingSkills?.length ? <small>Not found in listing: {selectedJob.scoreDetails.missingSkills.join(', ')}</small> : null}</div> : null}
          <div className="detail-description"><h3>Role description</h3>{selectedJob.description ? <RoleDescription text={selectedJob.description}/> : <p className="muted">Full job details have not been collected for this listing yet. Try again after the next scheduled collection.</p>}</div>
          <div className="detail-actions"><button className="primary" onClick={() => void draft(selectedJob)}><FileText size={16}/> Draft an application</button><button className="secondary" onClick={() => void scoreJob(selectedJob)}><Sparkles size={15}/> Refresh match score</button><a href={selectedJob.url} target="_blank" rel="noreferrer" className="text-button source-link">Original source <ExternalLink size={14}/></a></div>
        </article>
      </section>}
      {page === 'applications' && <section className="panel"><div className="section-title"><div><h2>Your applications</h2><p>Track your progress from draft to decision.</p></div></div>{applications.length === 0 ? <div className="empty-state"><FileText size={28}/><h3>No applications yet</h3><p>Draft an application from a job listing to get started.</p></div> : <div className="application-list">{applications.map((application) => { const job = jobs.find((item) => item.id === application.jobId); return <article className="application-row" key={application.id}><div className="company-logo small"><FileText size={17}/></div><div className="application-main"><h3>{job?.title ?? 'Job listing'}</h3><p>{job?.company ?? job?.location ?? 'Company not listed'} · Updated {new Date(application.updatedAt ?? application.createdAt ?? Date.now()).toLocaleDateString()}</p></div><span className={`status-pill ${application.status}`}>{application.status}</span><button className="secondary" onClick={() => { setSelectedApp(application); setLetter(application.letter ?? ''); setSelectedJob(job ?? null); const cv = documents.find((document) => document.documentType === 'cv'); setSelectedDocs(cv ? [cv.id] : []); }}>Open</button></article>; })}</div>}</section>}
      {page === 'profile' && <section className="profile-page">
        <div className="profile-intro"><span className="profile-avatar"><CircleUserRound size={24}/></span><div><p className="eyebrow">YOUR CAREER DETAILS</p><h2>Build your professional profile</h2><p>Import your CV to get started, then review and edit every detail. Your profile is only used to prepare job matches and application drafts.</p></div></div>
        <div className="upload-card"><div className="upload-icon"><FileText size={21}/></div><div className="upload-copy"><h3>{documents.some((document) => document.documentType === 'cv') ? 'Resume uploaded' : 'Start with your CV or resume'}</h3><p>Upload a PDF or Word document (DOCX, up to 10 MB). We’ll extract details for you to check before saving.</p>{documents.filter((document) => document.documentType === 'cv').slice(-1).map((document) => <span className="uploaded-file" key={document.id}><Check size={14}/>{document.name}</span>)}</div><label className="secondary upload-button">{busy ? 'Reading…' : 'Upload CV'}<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { void importCv(event.target.files?.[0]); event.currentTarget.value = ''; }} disabled={busy}/></label></div>
        <section className="profile-form-card"><div className="form-heading"><div><h3>Personal information</h3><p>Basic details used in your application letters.</p></div><span className="private-tag">Private</span></div><div className="form-grid"><label className="form-field">Full name<input value={String(profileData.name ?? '')} onChange={(event) => updateProfileField('name', event.target.value)} placeholder="e.g. Jane Banda"/></label><label className="form-field">Email address<input type="email" value={String(profileData.email ?? '')} onChange={(event) => updateProfileField('email', event.target.value)} placeholder="you@example.com"/></label><label className="form-field">Phone number<input value={String(profileData.phone ?? '')} onChange={(event) => updateProfileField('phone', event.target.value)} placeholder="+265 …"/></label><label className="form-field">Location<input value={String(profileData.location ?? '')} onChange={(event) => updateProfileField('location', event.target.value)} placeholder="City, country"/></label></div><label className="form-field full-field">Professional summary<textarea rows={3} value={String(profileData.summary ?? '')} onChange={(event) => updateProfileField('summary', event.target.value)} placeholder="A short summary of your experience and strengths"/></label></section>
        <section className="profile-form-card"><div className="form-heading"><div><h3>Experience & qualifications</h3><p>Use one item per line. Only include accurate, verifiable information.</p></div></div><div className="form-grid"><label className="form-field">Key skills<textarea rows={5} value={listValue(profileData.skills).join('\n')} onChange={(event) => updateProfileField('skills', event.target.value)} placeholder={'Project management\nData analysis\nCommunication'}/></label><label className="form-field">Work experience<textarea rows={5} value={listValue(profileData.roles).join('\n')} onChange={(event) => updateProfileField('roles', event.target.value)} placeholder={'Job title — Employer (years)\nKey responsibilities or achievements'}/></label><label className="form-field">Preferred job locations<textarea rows={3} value={listValue(profileData.preferredLocations).join('\n')} onChange={(event) => updateProfileField('preferredLocations', event.target.value)} placeholder={'Lilongwe\nBlantyre\nRemote'}/></label><label className="form-field">Target seniority or levels<textarea rows={3} value={listValue(profileData.seniority).join('\n')} onChange={(event) => updateProfileField('seniority', event.target.value)} placeholder={'Senior\nManager\nEntry level'}/></label><label className="form-field">Education & certifications<textarea rows={4} value={listValue(profileData.education).join('\n')} onChange={(event) => updateProfileField('education', event.target.value)} placeholder={'Qualification — Institution (year)'}/></label><label className="form-field">Referees<textarea rows={4} value={listValue(profileData.referees).join('\n')} onChange={(event) => updateProfileField('referees', event.target.value)} placeholder={'Name — Role, organization, contact details'}/></label></div><div className="profile-save-row"><p className="muted tiny">Your changes are not saved until you select Save profile.</p><button className="primary" onClick={() => void saveProfile()} disabled={busy}>Save profile</button></div></section>
      </section>}
    </main>

    {selectedApp && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedApp(null); }}><section className="drawer"><div className="drawer-head"><div><p className="eyebrow">APPLICATION WORKSPACE</p><h2>{selectedJob?.title ?? 'Application draft'}</h2></div><button className="icon-button" onClick={() => setSelectedApp(null)}><X size={19}/></button></div><div className="drawer-body"><p className="field-label">Cover letter · version {selectedApp.letterVersion}</p><textarea className="letter-editor" value={letter} onChange={(event) => setLetter(event.target.value)} placeholder="Draft a letter from a job listing..."/><div className="editor-footer"><button className="secondary" onClick={() => void downloadLetterPdf(selectedApp)}>Export PDF</button><button className="primary" onClick={() => void saveLetter()} disabled={busy}>Save edits</button></div><hr/><div className="section-title"><div><h3>Attachments</h3><p>Your CV is included by default. Select any additional documents.</p></div></div>{documents.length === 0 ? <p className="muted tiny">No registered documents yet. Add document metadata through the API.</p> : documents.map((document) => <label className="document-option" key={document.id}><input type="checkbox" checked={selectedDocs.includes(document.id)} disabled={document.documentType === 'cv' && selectedDocs.includes(document.id)} onChange={(event) => setSelectedDocs((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))}/><FileText size={17}/><span>{document.name}<small>{document.documentType === 'cv' && selectedDocs.includes(document.id) ? 'Required resume' : document.documentType}</small></span></label>)}<div className="send-notice">Sending is never automatic. Review the recipient, letter, and attachments before confirming.</div><button className="primary wide" onClick={() => void previewSend(selectedApp)} disabled={busy || !selectedApp.letter}><Send size={16}/> Review before sending</button></div></section></div>}
    {sendPreview && selectedApp && <div className="modal-backdrop"><section className="confirm-modal"><button className="modal-close icon-button" onClick={() => setSendPreview(null)}><X size={18}/></button><span className="confirm-icon"><Send size={19}/></span><p className="eyebrow">FINAL REVIEW</p><h2>Ready to send?</h2><p className="muted">This email will be sent to:</p><div className="recipient-box"><b>{sendPreview.recipient}</b><span>{sendPreview.subject}</span></div><div className="preview-letter">{sendPreview.letter}</div><p className="tiny muted">Attachments: Cover Letter PDF{sendPreview.documents.map((document) => `, ${document.name}`)}</p><div className="modal-actions"><button className="secondary" onClick={() => setSendPreview(null)}>Go back</button><button className="primary" onClick={() => void confirmSend()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} Confirm send</button></div></section></div>}
    {busy && <div className="busy-indicator"><LoaderCircle className="spin" size={17}/> Updating…</div>}
  </div>;
}

export default App;
