const fs = require('fs');
const path = require('path');

const METADATA_FILE = 'cloud.txt';
const IGNORED_NAMES = new Set([
    METADATA_FILE,
    '.gitkeep',
    '.ds_store',
    'thumbs.db',
    'desktop.ini'
]);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const DOC_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv']);

function fileKind(ext) {
    if (IMAGE_EXT.has(ext)) return 'image';
    if (VIDEO_EXT.has(ext)) return 'video';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (DOC_EXT.has(ext)) return 'document';
    return 'file';
}

function parseCloudTxt(content) {
    const meta = { name: '', description: '', type: '' };
    const lines = String(content || '').split(/\r?\n/);
    let descKey = false;

    for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();
            descKey = false;
            if (key === 'name') meta.name = value;
            else if (key === 'description') {
                meta.description = value;
                descKey = true;
            } else if (key === 'type') meta.type = value.toLowerCase();
            else meta[key] = value;
        } else if (descKey && line.trim()) {
            meta.description += (meta.description ? '\n' : '') + line.trim();
            descKey = true;
        }
    }

    return meta;
}

function readMetadata(folderPath, folderId) {
    const metaPath = path.join(folderPath, METADATA_FILE);
    let parsed = { name: '', description: '', type: '' };

    if (fs.existsSync(metaPath)) {
        try {
            parsed = parseCloudTxt(fs.readFileSync(metaPath, 'utf8'));
        } catch {
            /* ignore read errors */
        }
    }

    return {
        id: folderId,
        name: parsed.name || path.basename(folderPath),
        description: parsed.description || '',
        type: parsed.type || 'auto',
        extras: Object.fromEntries(
            Object.entries(parsed).filter(([k]) => !['name', 'description', 'type'].includes(k))
        )
    };
}

function isIgnoredEntry(name) {
    if (!name || name.startsWith('.')) return true;
    return IGNORED_NAMES.has(name.toLowerCase());
}

function safeJoin(root, relativePath) {
    let normalized = path
        .normalize(relativePath || '')
        .replace(/^(\.\.(\/|\\|$))+/, '')
        .replace(/^[/\\]+/, '');
    if (normalized === '.' || normalized === './') {
        normalized = '';
    }
    const full = normalized ? path.resolve(root, normalized) : path.resolve(root);
    const rootResolved = path.resolve(root);
    if (!full.startsWith(rootResolved)) {
        return null;
    }
    return { full, relative: normalized.replace(/\\/g, '/') };
}

function scanFolder(root, relativePath = '') {
    const joined = safeJoin(root, relativePath);
    if (!joined) return null;

    const { full, relative } = joined;
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
        return null;
    }

    const meta = readMetadata(full, relative || '/');
    const folders = [];
    const files = [];

    let entries;
    try {
        entries = fs.readdirSync(full, { withFileTypes: true });
    } catch {
        return null;
    }

    for (const entry of entries) {
        if (isIgnoredEntry(entry.name)) continue;

        const childRel = relative ? `${relative}/${entry.name}` : entry.name;
        const childFull = path.join(full, entry.name);

        if (entry.isDirectory()) {
            const childMeta = readMetadata(childFull, childRel);
            let fileCount = 0;
            try {
                fileCount = fs.readdirSync(childFull).filter((n) => !isIgnoredEntry(n)).length;
            } catch {
                fileCount = 0;
            }
            folders.push({
                id: childRel,
                name: childMeta.name,
                description: childMeta.description,
                type: childMeta.type,
                fileCount
            });
            continue;
        }

        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        let stat;
        try {
            stat = fs.statSync(childFull);
        } catch {
            continue;
        }

        files.push({
            name: entry.name,
            url: `/cloud/${childRel.split('/').map(encodeURIComponent).join('/')}`,
            kind: fileKind(ext),
            ext: ext.slice(1),
            size: stat.size,
            modified: stat.mtime.toISOString()
        });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    const resolvedType =
        meta.type && meta.type !== 'auto'
            ? meta.type
            : inferViewType(files);

    return {
        path: relative,
        name: meta.name || (relative ? path.basename(relative) : 'Облако'),
        description: meta.description,
        type: resolvedType,
        extras: meta.extras,
        folders,
        files,
        updatedAt: new Date().toISOString()
    };
}

function inferViewType(files) {
    if (!files.length) return 'empty';
    const kinds = new Set(files.map((f) => f.kind));
    if (kinds.size === 1 && kinds.has('image')) return 'gallery';
    if (kinds.has('image') && kinds.size > 1) return 'mixed';
    if (kinds.has('document') && !kinds.has('image')) return 'documents';
    return 'files';
}

function ensureCloudRoot(root) {
    if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
    }
}

module.exports = {
    METADATA_FILE,
    ensureCloudRoot,
    scanFolder,
    safeJoin
};
