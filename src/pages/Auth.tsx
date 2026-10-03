import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MeDTO } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk } from "../lib/queries";
import { Button, Field, TextInput, useFieldId } from "../components/ui";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10 pt-safe">
      <div className="mb-8">
        <div aria-hidden className="mb-6 grid size-14 place-items-center rounded-[18px] bg-accent text-[26px] font-bold tracking-tight text-accent-ink">
          O
        </div>
        <h1 className="text-[30px] leading-9 font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
      </div>
      {children}
    </main>
  );
}

function useAuthMutation(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) => api<MeDTO>(path, { method: "POST", body }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthMutation("/auth/login");
  const emailId = useFieldId("email");
  const pwId = useFieldId("pw");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };
  return (
    <Shell title="O-Budget" subtitle="Vos revenus, vos dépenses, votre épargne. Connectez-vous pour retrouver votre mois.">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="E-mail" htmlFor={emailId}>
          <TextInput id={emailId} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mot de passe" htmlFor={pwId} error={login.isError ? errorMessage(login.error) : null}>
          <TextInput id={pwId} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" block loading={login.isPending} className="mt-2">
          Se connecter
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-3 text-[15px]">
        <Link to="/inscription" className="font-semibold text-accent">Créer un compte</Link>
        <Link to="/mot-de-passe-oublie" className="text-muted hover:text-ink">Mot de passe oublié ?</Link>
      </div>
    </Shell>
  );
}

export function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const register = useAuthMutation("/auth/register");
  const nameId = useFieldId("name");
  const emailId = useFieldId("email");
  const pwId = useFieldId("pw");
  return (
    <Shell title="Créer votre compte" subtitle="Vos données restent privées : elles ne sont visibles que par vous.">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); register.mutate({ name, email, password }); }}>
        <Field label="Prénom" htmlFor={nameId}>
          <TextInput id={nameId} autoComplete="given-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-mail" htmlFor={emailId}>
          <TextInput id={emailId} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mot de passe" htmlFor={pwId} hint="8 caractères minimum." error={register.isError ? errorMessage(register.error) : null}>
          <TextInput id={pwId} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" block loading={register.isPending} className="mt-2">
          Créer mon compte
        </Button>
      </form>
      <p className="mt-6 text-center text-[15px] text-muted">
        Déjà un compte ? <Link to="/connexion" className="font-semibold text-accent">Se connecter</Link>
      </p>
    </Shell>
  );
}

export function ForgotPassword() {
  return (
    <Shell title="Mot de passe oublié" subtitle="O-Budget n'utilise aucun service d'e-mail payant : la réinitialisation se fait depuis l'ordinateur qui a servi au déploiement.">
      <ol className="flex list-decimal flex-col gap-3 rounded-[22px] bg-surface p-5 pl-10 text-[15px]">
        <li>Ouvrez un terminal dans le dossier du projet.</li>
        <li>
          Lancez <code className="rounded bg-raised px-1.5 py-0.5 text-[13px]">npm run reset-password -- votre@email.fr</code>
        </li>
        <li>Saisissez le nouveau mot de passe, puis connectez-vous.</li>
      </ol>
      <Link to="/connexion" className="mt-6 text-center text-[15px] font-semibold text-accent">
        Retour à la connexion
      </Link>
    </Shell>
  );
}
