// Réinitialise le mot de passe d'un compte O-Budget, sans service d'e-mail.
// Usage :
//   npm run reset-password -- votre@email.fr            (base de production)
//   npm run reset-password -- votre@email.fr --local    (base locale de développement)
// Le nouveau mot de passe est demandé de façon masquée. Toutes les sessions du compte sont fermées.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const DB_NAME = "o-budget";
const ITERATIONS = 100_000; // identique à worker/lib/crypto.ts

const args = process.argv.slice(2);
const local = args.includes("--local");
const email = (args.find((a) => !a.startsWith("--")) ?? "").trim().toLowerCase();

if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) {
  console.error("Indiquez l'adresse e-mail du compte : npm run reset-password -- votre@email.fr");
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = process.env.OB_NEW_PASSWORD ?? (await askHidden("Nouveau mot de passe (8 caractères minimum) : "));
if (password.length < 8 || password.length > 128) {
  console.error("Le mot de passe doit contenir entre 8 et 128 caractères.");
  process.exit(1);
}
if (!process.env.OB_NEW_PASSWORD) {
  const again = await askHidden("Confirmez le mot de passe : ");
  if (again !== password) {
    console.error("Les deux mots de passe ne correspondent pas.");
    process.exit(1);
  }
}

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha256").toString("hex");

// Valeurs hex et e-mail validé ci-dessus : aucune apostrophe possible dans la requête.
const sql =
  `UPDATE users SET password_hash = '${hash}', password_salt = '${salt}', password_iterations = ${ITERATIONS}, ` +
  `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE email = '${email}'; ` +
  `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${email}'); ` +
  `DELETE FROM auth_attempts WHERE key = 'email:${email}';`;

function d1(command) {
  try {
    const out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", DB_NAME, local ? "--local" : "--remote", "--json", "--command", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    return JSON.parse(out);
  } catch {
    console.error("La commande wrangler a échoué. Êtes-vous connecté (npx wrangler login) ?");
    process.exit(1);
  }
}

const found = d1(`SELECT id FROM users WHERE email = '${email}'`);
if (!found[0]?.results?.length) {
  console.error(`Aucun compte trouvé pour ${email}.`);
  process.exit(1);
}
d1(sql);
console.log(`Mot de passe modifié pour ${email}. Vous pouvez vous connecter.`);
