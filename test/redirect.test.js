/**
 * This page is the single point of failure for every sign-in.
 *
 * It exists because Google's account router intercepts a direct redirect back to
 * script.google.com and dies before doGet ever runs - reproduced in Chrome and
 * Firefox with more than one Google account signed in. See the README. So if this
 * page is wrong, nobody can sign in to anything, and the failure shows up on a
 * host that is not ours.
 *
 * It has no build and no framework. This runs the real index.html in a stub DOM
 * and asserts on where it decides to send people.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];

let passed = 0; const failures = [];
const ok = (label, cond, detail) => cond ? passed++ : failures.push(label + (detail ? '  [' + detail + ']' : ''));
const eq = (label, a, b) => ok(label, a === b, 'got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));

const PORTAL = 'https://script.google.com/macros/s/AKfycbw9ITLeoTRo1qI-MkmkAdPpId7GeqwT6LgL8V9igMxkPpQmVvK_WYqtwhkIcU4GuTDh/exec';

function run(search, lang) {
  const el = () => ({ textContent: '', href: '', style: {} });
  const nodes = { spinner: el(), title: el(), msg: el(), go: el(), fallback: el() };
  let replaced = null;
  const frames = [];
  const sandbox = {
    document: { getElementById: (id) => nodes[id] || el(), documentElement: {} },
    window: { location: { search, replace: (u) => { replaced = u; } } },
    navigator: { language: lang || 'fr-CA' },
    URLSearchParams,
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: () => {},
    console
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  // The page defers navigation by two animation frames so its message is painted.
  while (frames.length) frames.shift()();
  return { replaced, nodes, framesUsed: true };
}

// ============================================== it forwards to the right place
const good = run('?state=abc123.portal&code=4%2F0AX4');
ok('a portal state lands on the portal', String(good.replaced).indexOf(PORTAL) === 0);
ok('...carrying the code', /code=4%2F0AX4/.test(good.replaced));
ok('...carrying the state', /state=abc123.portal/.test(good.replaced));

const sc = run('?state=zz.safecount&code=xyz');
ok('a safecount state lands somewhere else entirely',
   String(sc.replaced).indexOf(PORTAL) !== 0 && /script\.google\.com/.test(String(sc.replaced)));

// TWO keys for Cash Balancing, and the distinction is the whole point. Both apps
// are built from one repo, so a single key would make both claim to be the same
// app: point it at production and a sign-in begun in the test app is forwarded to
// production, the state still validates, and somebody files a count into the real
// spreadsheet believing they are in test. Silently wrong, not broken.
const sct = run('?state=zz.safecount-test&code=xyz');
ok('the test app has a key of its own', String(sct.replaced).indexOf('script.google.com') !== -1);
ok('...which is not the portal', String(sct.replaced).indexOf(PORTAL) !== 0);

// Until the trial starts the real deployment does not exist, so both point at the
// test one. The assertion is deliberately about them being SEPARATELY LISTED
// rather than about their values: the values diverge at step 9 of the trial and
// this check has to survive that, or it goes red for the change it exists to allow.
const dests = script.slice(script.indexOf('var DESTINATIONS'), script.indexOf('var incoming'));
ok('both keys are listed in their own right',
   /'safecount':/.test(dests) && /'safecount-test':/.test(dests));
ok('...and nothing else crept into the allowlist',
   (dests.match(/^\s*'[a-z-]+':/gm) || []).length === 3);

// They diverged on 2026-08-26 when the trial deployment went live, and pointing
// them at the same place again is not a tidy-up - it is the bug this split exists
// to prevent. Signing in on the trial minted a state saying 'safecount', this page
// forwarded it to test, the test app rejected the mismatched key and bounced to a
// fresh sign-in, and the second attempt landed IN THE TEST APP. Two sign-ins and
// the wrong spreadsheet, with no error anywhere.
const urlFor = (k) => (dests.match(new RegExp("'" + k + "':\\s*'([^']+)'")) || [])[1];
ok('the two Cash Balancing keys point at DIFFERENT deployments',
   urlFor('safecount') && urlFor('safecount-test') &&
   urlFor('safecount') !== urlFor('safecount-test'),
   'safecount -> ' + urlFor('safecount') + ' | safecount-test -> ' + urlFor('safecount-test'));
// Deliberately not pinned to a literal id: the trial deployment gets replaced at
// cutover and this check has to survive that. What must stay true is that the real
// key is not aimed at the test one.
ok('...and the real key is not aimed at the test deployment',
   urlFor('safecount').indexOf('AKfycbw8ajAFSUJy') === -1);

// ================================================= it drops what it must drop
const noisy = run('?state=abc.portal&code=c1&authuser=2&scope=email+profile&iss=https%3A%2F%2Faccounts.google.com&prompt=consent');
ok('authuser is dropped', !/authuser/.test(noisy.replaced));
ok('scope is dropped',    !/scope=/.test(noisy.replaced));
ok('iss is dropped',      !/iss=/.test(noisy.replaced));
ok('prompt is dropped',   !/prompt=/.test(noisy.replaced));

// authuser is part of what makes a direct redirect fail, so forwarding it would
// reintroduce the exact bug this page exists to route around.

// ====================================================== it refuses to guess
const evil = run('?state=abc.attacker&code=c1');
eq('an unrecognised app key navigates nowhere', evil.replaced, null);
ok('...and says so', /reconnu|recognised/i.test(evil.nodes.title.textContent));
ok('...offering the portal, not the unknown key', evil.nodes.go.href === PORTAL);

// The attack shape is an UNRECOGNISED key plus a destination in the query string:
// with a valid key the allowlist answers first and a fallback would never be
// reached, so testing that combination proves nothing. Carrying the destination
// in the URL is what would make this page usable to lend our domain to a
// phishing link.
const openRedirect = run('?state=abc.attacker&code=c1&redirect_uri=https%3A%2F%2Fevil.invalid');
eq('an unknown key plus a supplied destination navigates nowhere', openRedirect.replaced, null);
ok('...and never names the supplied destination',
   !/evil\.invalid/.test(String(openRedirect.replaced) + openRedirect.nodes.go.href));

const openRedirect2 = run('?state=abc.attacker&code=c1&dest=https%3A%2F%2Fevil.invalid&url=https%3A%2F%2Fevil.invalid&next=https%3A%2F%2Fevil.invalid');
eq('...whatever the parameter is called', openRedirect2.replaced, null);

// ======================================================== the idle case
const idle = run('');
eq('a bare visit navigates nowhere', idle.replaced, null);
ok('...and explains itself', idle.nodes.title.textContent.length > 0);

const err = run('?state=abc.portal&error=access_denied');
ok('an error from Google is forwarded, not swallowed', /error=access_denied/.test(String(err.replaced)));

// ============================================================ language
eq('French by default',  run('?state=a.portal&code=c', 'fr-CA').nodes.title.textContent, 'Connexion en cours…');
eq('English when the device is English', run('?state=a.portal&code=c', 'en-CA').nodes.title.textContent, 'Signing you in…');
eq('...and the button follows', run('?state=a.portal&code=c', 'en-GB').nodes.go.textContent, 'Continue');

// ====================================================== the paint guarantee
// §25: moving the navigation into <head> so nothing painted produced a blank
// white screen for the length of a network round trip, which reads as a crash.
ok('navigation is deferred behind animation frames, not issued inline',
   /requestAnimationFrame\([\s\S]*?requestAnimationFrame\(/.test(script));
ok('it uses replace(), leaving no back-button trap', /location\.replace\(/.test(script));

console.log('\nauth-redirect');
console.log('-------------');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + failures.length + ' FAILED, ' + passed + ' passed');
  process.exit(1);
}
console.log('  ' + passed + ' passed, 0 failed');
