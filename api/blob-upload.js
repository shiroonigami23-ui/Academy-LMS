const { getSql, getStudentByDevice, getStudentFromSession, assertStudentAllowed } = require('./_lib/db');
const { allowMethods, readJsonBody, sendJson } = require('./_lib/http');
const { applyRateLimit } = require('./_lib/rate-limit');

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PPT_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AUTO_CHECK_PREFIX = '[AUTO_CHECK] ';

function parsePayload(rawPayload) {
    try {
        return rawPayload ? JSON.parse(rawPayload) : {};
    } catch (error) {
        return {};
    }
}

function sanitizeSlug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'upload';
}

function inferCourseKey(payload) {
    const source = `${payload.title || ''} ${payload.description || ''} ${payload.originalName || ''}`.toLowerCase();
    if (source.includes('cs602') || source.includes('computer network') || source.includes('network')) return 'cs602';
    if (source.includes('cs601') || source.includes('machine learning') || source.includes('ml')) return 'cs601';
    if (source.includes('cs603') || source.includes('compiler')) return 'cs603';
    if (source.includes('cs604') || source.includes('project management') || source.includes('pm')) return 'cs604';
    return 'generic';
}

function getKeywordBank(courseKey) {
    const bank = {
        cs602: ['osi', 'tcp', 'udp', 'ip', 'routing', 'subnet', 'dns', 'http', 'firewall', 'tls'],
        cs601: ['model', 'training', 'dataset', 'loss', 'gradient', 'feature', 'overfitting', 'validation'],
        cs603: ['parser', 'lexer', 'grammar', 'syntax', 'optimization', 'code generation', 'ast'],
        cs604: ['scope', 'timeline', 'risk', 'stakeholder', 'milestone', 'resource', 'budget'],
        generic: ['definition', 'example', 'advantages', 'limitations', 'applications']
    };
    return bank[courseKey] || bank.generic;
}

async function extractPdfText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to fetch uploaded PDF for review (${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(buffer);
    return String(parsed.text || '').toLowerCase();
}

async function runSolutionKeywordCheck(blob, payload) {
    const contentType = String(blob.contentType || '').toLowerCase();
    const isPdf = contentType.includes('pdf') || String(blob.pathname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) {
        return {
            status: 'skipped',
            reason: 'keyword check runs for PDF files only'
        };
    }

    try {
        const text = await extractPdfText(blob.downloadUrl || blob.url);
        const courseKey = inferCourseKey(payload);
        const expected = getKeywordBank(courseKey);
        const matched = expected.filter((keyword) => text.includes(keyword));
        const score = expected.length ? Math.round((matched.length / expected.length) * 100) : 0;

        return {
            status: score >= 45 ? 'likely-correct' : 'needs-review',
            course: courseKey,
            score,
            matchedKeywords: matched,
            expectedKeywords: expected
        };
    } catch (error) {
        return {
            status: 'error',
            reason: error.message || 'Unable to run keyword check.'
        };
    }
}

function withAutoCheck(description, autoCheck) {
    const safeDescription = String(description || '').trim();
    return `${safeDescription}\n${AUTO_CHECK_PREFIX}${JSON.stringify(autoCheck)}`.trim();
}

module.exports = async function handler(req, res) {
    if (!allowMethods(req, res, ['POST'])) return;
    if (!applyRateLimit(req, res, { scope: 'blob-upload', limit: 20, windowMs: 60000 })) return;

    try {
        if (!process.env.BLOB_READ_WRITE_TOKEN) {
            sendJson(res, 503, { error: 'Vercel Blob is not configured yet. Connect Blob storage in Vercel first.' });
            return;
        }

        const body = await readJsonBody(req);
        const { handleUpload } = await import('@vercel/blob/client');
        const sql = await getSql();

        const jsonResponse = await handleUpload({
            body,
            request: req,
            onBeforeGenerateToken: async (_pathname, clientPayload) => {
                const payload = parsePayload(clientPayload);
                const deviceId = String(payload.deviceId || '').trim();
                const uploadKind = String(payload.uploadKind || '').trim();
                const originalName = String(payload.originalName || '').trim();

                if (!deviceId || !uploadKind) {
                    throw new Error('deviceId and uploadKind are required.');
                }

                const sessionStudent = await getStudentFromSession(req, sql);
                const student = sessionStudent || await getStudentByDevice(sql, deviceId);
                if (!student) {
                    throw new Error('Student profile not found. Sync the profile first.');
                }
                assertStudentAllowed(student);

                const isAvatar = uploadKind === 'avatar';
                return {
                    allowedContentTypes: isAvatar
                        ? ['image/jpeg', 'image/png', 'image/webp']
                        : [
                            'application/pdf',
                            'application/vnd.ms-powerpoint',
                            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                        ],
                    addRandomSuffix: true,
                    tokenPayload: JSON.stringify({
                        deviceId,
                        studentId: student.id,
                        uploadKind,
                        originalName,
                        title: payload.title || originalName,
                        description: payload.description || ''
                    })
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                const payload = parsePayload(tokenPayload);
                const sizeBytes = Number(blob.size || 0);
                const uploadKind = payload.uploadKind;
                const contentType = String(blob.contentType || '').toLowerCase();
                const isPdf = contentType.includes('pdf') || String(blob.pathname || '').toLowerCase().endsWith('.pdf');
                const isPpt = contentType.includes('presentation')
                    || contentType.includes('powerpoint')
                    || String(blob.pathname || '').toLowerCase().endsWith('.ppt')
                    || String(blob.pathname || '').toLowerCase().endsWith('.pptx');

                if (uploadKind === 'study-pdf' && isPdf && sizeBytes > MAX_PDF_BYTES) {
                    throw new Error('Study PDF exceeds the 10 MB limit.');
                }

                if (uploadKind === 'study-pdf' && isPpt && sizeBytes > MAX_PPT_BYTES) {
                    throw new Error('PPT/PPTX exceeds the 25 MB limit.');
                }

                if (uploadKind === 'avatar' && sizeBytes > MAX_AVATAR_BYTES) {
                    throw new Error('Avatar image exceeds the 2 MB limit.');
                }

                if (uploadKind === 'avatar') {
                    await sql`
                        UPDATE students
                        SET avatar_url = ${blob.url}, updated_at = NOW()
                        WHERE id = ${payload.studentId}
                    `;
                }

                const autoCheck = uploadKind === 'study-pdf'
                    ? await runSolutionKeywordCheck(blob, payload)
                    : null;

                await sql`
                    INSERT INTO student_uploads (
                        student_id,
                        upload_kind,
                        title,
                        description,
                        blob_url,
                        download_url,
                        pathname,
                        content_type,
                        size_bytes
                    )
                    VALUES (
                        ${payload.studentId},
                        ${uploadKind},
                        ${payload.title || payload.originalName || 'Student Upload'},
                        ${withAutoCheck(payload.description || '', autoCheck || { status: 'skipped', reason: 'not-applicable' })},
                        ${blob.url},
                        ${blob.downloadUrl || blob.url},
                        ${blob.pathname || sanitizeSlug(payload.originalName)},
                        ${blob.contentType || (uploadKind === 'avatar' ? 'image/*' : 'application/pdf')},
                        ${sizeBytes}
                    )
                    ON CONFLICT (blob_url)
                    DO NOTHING
                `;
            }
        });

        sendJson(res, 200, jsonResponse);
    } catch (error) {
        console.error('Blob upload error', error);
        sendJson(res, 400, { error: error.message || 'Unable to prepare upload.' });
    }
};
