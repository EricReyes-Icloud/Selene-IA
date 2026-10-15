/**
 * Firestore security rules tests for /firestore.rules.
 *
 * Runs against the Firebase Emulator — never against a real project. The
 * emulator is started by `npm run test:rules` and this file only talks to it.
 *
 * Runner: node --test (no extra test framework dependency).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-selene-ia';
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const NEW_UID = 'new-user-uid';
const OWNER_EMAIL = 'owner@selene.test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8');

// Provided by `firebase emulators:exec`; the fallback matches firebase.json.
const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080')
    .split(':');

let testEnv;

/** A stored profile as the onboarding flow leaves it. */
const completedProfile = () => ({
    email: OWNER_EMAIL,
    displayName: 'Owner',
    photoURL: null,
    onboardingComplete: true,
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp(),
});

/** Existence check for documents written through `serverTimestamp()`. */
const exists = (snapshot) => snapshot.exists();

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules,
            host: emulatorHost,
            port: Number(emulatorPort),
        },
    });
});

after(async () => {
    await testEnv?.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
});

/**
 * Writes a stored profile as an admin-equivalent context, so the rules under
 * test only ever see the operations each test performs.
 * Called by the suites that need an existing document to update or read.
 */
async function seedCompletedProfile(uid = OWNER_UID, email = OWNER_EMAIL) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
            doc(context.firestore(), 'users', uid),
            { ...completedProfile(), email }
        );
    });
}

describe('users/{uid} - updating the own profile', () => {
    beforeEach(async () => {
        await seedCompletedProfile();
    });

    test('accepts the exact payload the onboarding flow saves', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertSucceeds(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Eric',
                discoverySource: 'google',
                usageIntent: 'work',
                onboardingComplete: true,
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('accepts a single allowlisted field', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertSucceeds(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Eric',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects an update to the protected field "role"', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                role: 'admin',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects an update to the protected field "plan"', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                plan: 'enterprise',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects an update to the protected field "permissions"', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                permissions: ['admin'],
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects an unknown field added by a future feature', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                isAdmin: true,
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects a mixed payload: allowlisted field plus protected field', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Eric',
                role: 'admin',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects re-opening onboarding (onboardingComplete back to false)', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                onboardingComplete: false,
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects a client-supplied updatedAt instead of a server timestamp', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Eric',
                updatedAt: new Date('2000-01-01T00:00:00Z'),
            })
        );
    });
});

describe('users/{uid} - per-user isolation', () => {
    beforeEach(async () => {
        await seedCompletedProfile();
    });

    test("rejects reading another user's profile", async () => {
        const db = testEnv.authenticatedContext(OTHER_UID, { email: 'other@selene.test' }).firestore();

        await assertFails(getDoc(doc(db, 'users', OWNER_UID)));
    });

    test("rejects updating another user's profile", async () => {
        const db = testEnv.authenticatedContext(OTHER_UID, { email: 'other@selene.test' }).firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Intruder',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test('rejects reading a profile without authentication', async () => {
        const db = testEnv.unauthenticatedContext().firestore();

        await assertFails(getDoc(doc(db, 'users', OWNER_UID)));
    });

    test('rejects updating a profile without authentication', async () => {
        const db = testEnv.unauthenticatedContext().firestore();

        await assertFails(
            updateDoc(doc(db, 'users', OWNER_UID), {
                preferredName: 'Intruder',
                updatedAt: serverTimestamp(),
            })
        );
    });

    test("rejects reading another user's chats", async () => {
        const db = testEnv.authenticatedContext(OTHER_UID, { email: 'other@selene.test' }).firestore();

        await assertFails(getDoc(doc(db, 'users', OWNER_UID, 'chats', 'chat-1')));
    });
});

describe('users/{uid} - creating the own profile', () => {
    // A fresh uid: an unseeded path is a real create, not an update.
    const NEW_EMAIL = 'new-user@selene.test';
    const newUser = () => testEnv.authenticatedContext(NEW_UID, { email: NEW_EMAIL }).firestore();

    test('accepts the exact payload createUserProfile writes', async () => {
        await assertSucceeds(
            setDoc(doc(newUser(), 'users', NEW_UID), {
                email: NEW_EMAIL,
                displayName: 'New User',
                photoURL: null,
                onboardingComplete: false,
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
            })
        );
    });

    test('rejects a creation that injects a protected field', async () => {
        await assertFails(
            setDoc(doc(newUser(), 'users', NEW_UID), {
                ...completedProfile(),
                email: NEW_EMAIL,
                onboardingComplete: false,
                role: 'admin',
            })
        );
    });

    test('rejects a creation that pre-completes onboarding', async () => {
        await assertFails(
            setDoc(doc(newUser(), 'users', NEW_UID), {
                ...completedProfile(),
                email: NEW_EMAIL,
                onboardingComplete: true,
            })
        );
    });

    test('rejects a profile created with an email that is not the authenticated one', async () => {
        await assertFails(
            setDoc(doc(newUser(), 'users', NEW_UID), {
                ...completedProfile(),
                email: 'someone-else@selene.test',
                onboardingComplete: false,
            })
        );
    });

    test('rejects a profile created without server timestamps', async () => {
        await assertFails(
            setDoc(doc(newUser(), 'users', NEW_UID), {
                email: NEW_EMAIL,
                displayName: 'New User',
                photoURL: null,
                onboardingComplete: false,
                createdAt: new Date('2000-01-01T00:00:00Z'),
                lastLogin: new Date('2000-01-01T00:00:00Z'),
            })
        );
    });
});

describe('users/{uid} - deleting a profile', () => {
    beforeEach(async () => {
        await seedCompletedProfile();
    });

    test('rejects deleting a profile from the client', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        await assertFails(deleteDoc(doc(db, 'users', OWNER_UID)));
    });
});

describe('users/{uid}/chats - owner-only history', () => {
    test('lets the owner create a chat and add a message', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        const chat = await assertSucceeds(
            addDoc(collection(db, 'users', OWNER_UID, 'chats'), {
                title: 'Hola...',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })
        );

        await assertSucceeds(
            addDoc(collection(db, 'users', OWNER_UID, 'chats', chat.id, 'messages'), {
                text: 'Hola',
                role: 'user',
                timestamp: serverTimestamp(),
            })
        );

        await assertSucceeds(getDoc(doc(db, 'users', OWNER_UID, 'chats', chat.id)));
    });

    test('rejects writing a chat into another user profile', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID, { email: 'other@selene.test' }).firestore();

        await assertFails(
            addDoc(collection(db, 'users', OWNER_UID, 'chats'), {
                title: 'Injected',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })
        );
    });
});

describe('profile existence guard', () => {
    beforeEach(async () => {
        await seedCompletedProfile();
    });

    test('the seeded profile is readable by its owner', async () => {
        const db = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL }).firestore();

        const snapshot = await assertSucceeds(getDoc(doc(db, 'users', OWNER_UID)));

        // Guards the seed helper used by every test above.
        if (!exists(snapshot)) {
            throw new Error('seeded profile is missing');
        }
    });
});
