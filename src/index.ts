import { getDomainWithoutSuffix } from 'tldts';
import words from './words.json';

// TODO: A bit rushed atm, database calls should be separated

interface AliasDb {
    alias: string;
    domain: string;
    created_at: string; // ISO 8601
    active: number; // 0 or 1
    hostname: string | null;
}

const isValidAuth = async (env: Env, value: string) => {
    const valueBuffer = new TextEncoder().encode(value);
    const saltBuffer = new TextEncoder().encode(env.SALT);
    const combinedBuffer = new Uint8Array([...valueBuffer, ...saltBuffer]);
    const hashBuffer = await crypto.subtle.digest('SHA-256', combinedBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === env.HASH;
}

const generateAlias = (lengt: number, separator: string) => {
    const wordsLength = words.length;
    const alias = Array.from({ length: lengt }, () => words[Math.floor(Math.random() * wordsLength)]);
    return alias.join(separator);
}

const getAlias = async (env: Env, alias: string, domain: string) => {
    const stmt = env.db.prepare('SELECT * FROM aliases WHERE alias = ?1 AND domain = ?2').bind(alias, domain);
    const result = await stmt.first<AliasDb>();
    return result;
}

const aliasIsAvailable = async (env: Env, alias: string, domain: string) => {
    return (await getAlias(env, alias, domain)) === null;
}

const createAlias = async (env: Env, hostname: string | null = null) => {
    let alias = generateAlias(3, '-');
    while (!await aliasIsAvailable(env, alias, env.DOMAIN)) {
        alias = generateAlias(3, '-');
    }
    const stmt = env.db.prepare('INSERT INTO aliases (alias, domain, created_at, active, hostname) VALUES (?1, ?2, ?3, ?4, ?5)').bind(alias, env.DOMAIN, new Date().toISOString(), 1, hostname);
    await stmt.run();
    return { alias, domain: env.DOMAIN, formatted: `${alias}@${env.DOMAIN}` };
}

const getHostnameSuggestion = (hostname: string | null) => {
    if (hostname === null) {
        return generateAlias(3, '-');
    }
    let suffix = getDomainWithoutSuffix(hostname);
    if (suffix === null) {
        return generateAlias(3, '-');
    }
    suffix = suffix.replace(/-/g, ''); // kinda wack but needed
    return `${suffix}-${generateAlias(2, '-')}`;
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const url = new URL(request.url);

        const authenticationValue = request.headers.get('authentication');

        if (authenticationValue === null || authenticationValue === undefined || !(await isValidAuth(env, authenticationValue))) {
            return new Response('Unauthorized', { status: 401 });
        }

        if (url.pathname === '/api/api_key') {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (url.pathname === '/api/user_info') {
            return new Response(JSON.stringify({ name: 'Edwinexd/forward-email-cf', is_premium: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (url.pathname === '/api/mailboxes') {
            return new Response(JSON.stringify({ mailboxes: [{ "id": 1, "email": "default" }] }), {});
        }

        if (url.pathname === '/api/v4/alias/options') {
            const hostname = url.searchParams.get('hostname');
            return new Response(JSON.stringify({ suffixes: [["@" + env.DOMAIN]], prefix_suggestion: getHostnameSuggestion(hostname), can_create: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (url.pathname === '/api/v2/aliases') {
            const pageId = url.searchParams.get('page_id');
            // pageid must be a number
            if (pageId === null || pageId.match(/^\d+$/) === null) {
                return new Response('Bad Request', { status: 400 });
            }
            const page = parseInt(pageId);
            const stmt = env.db.prepare('SELECT * FROM aliases WHERE domain = ?1 LIMIT ?2 OFFSET ?3').bind(env.DOMAIN, 10, (page - 1) * 10);
            const result = await stmt.all<AliasDb>();
            // alias.email
            // alias.enabled
            return new Response(JSON.stringify([...result.results.map(alias => ({ email: `${alias.alias}@${alias.domain}`, enabled: alias.active === 1 }))]), {
                headers: { 'Content-Type': 'application/json' },
            });


        }

        if (url.pathname === '/api/alias/random/new') {
            const alias = await createAlias(env, url.searchParams.get('hostname'));
            return new Response(JSON.stringify({
                alias: alias.formatted,
                name: alias.alias,
                mailboxes: [{ "id": 1, "email": "default" }],
                email: alias.formatted,
                id: alias.formatted
            }), {
                headers: { 'Content-Type': 'application/json' }, status: 201
            });
        }

        if (url.pathname === '/api/v2/alias/custom/new' && request.method === 'POST') {
            const body = await request.json();
            if (typeof body !== 'object' || body === null) {
                return new Response('Bad Request', { status: 400 });
            }
            if (!("alias_prefix" in body && typeof body.alias_prefix === 'string')) {
                return new Response('Bad Request', { status: 400 });
            }
            const alias = body.alias_prefix;
            if (alias.match(/(\w+-){2}\w+/) === null) {
                return new Response('Bad Request', { status: 400 });
            }

            if (!await aliasIsAvailable(env, alias, env.DOMAIN)) {
                return new Response('Conflict', { status: 409 });
            }

            const stmt = env.db.prepare('INSERT INTO aliases (alias, domain, created_at, active, hostname) VALUES (?1, ?2, ?3, ?4, ?5)').bind(alias, env.DOMAIN, new Date().toISOString(), 1, null);
            await stmt.run();

            return new Response(JSON.stringify({
                alias: `${alias}@${env.DOMAIN}`,
                name: alias,
                mailboxes: [{ "id": 1, "email": "default" }],
                email: `${alias}@${env.DOMAIN}`,
                id: `${alias}@${env.DOMAIN}`
            }), {
                headers: { 'Content-Type': 'application/json' }, status: 201
            });
        }

        if (url.pathname.match(/^\/api\/aliases\/(\w+-){2}\w+(@|%40).*$/) !== null && request.method === 'DELETE') {
            const alias = url.pathname.split('/')[3].replace('%40', '@');
            const [aliasName, domain] = alias.split('@');
            if (domain !== env.DOMAIN) {
                return new Response('Not Found', { status: 404 });
            }
            console.log(aliasName, domain);
            const stmt = env.db.prepare('DELETE FROM aliases WHERE alias = ?1 AND domain = ?2').bind(aliasName, domain);
            await stmt.run();
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response('Not Found', { status: 404 });
    },
    async email(message, env, ctx) {
        const to: string = message.to;
        const [alias, domain] = to.split('@');
        if (domain !== env.DOMAIN || alias.match(/(\w+-){2}\w+/) === null) {
            message.setReject("Invalid recipient");
            return;
        }
        const aliasDb = await getAlias(env, alias, domain);
        if (aliasDb === null || aliasDb.active === 0) {
            message.setReject("Invalid recipient");
            return;
        }
        const emails = env.TARGET_EMAILS.split(',').map(e => e.trim()).filter(e => e.length > 0);
        for (const email of emails) {
            await message.forward(email);
        }
    }
} satisfies ExportedHandler<Env>;
