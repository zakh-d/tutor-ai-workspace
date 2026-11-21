import Keycloak from "keycloak-js";
import { setTokenProvider } from "./api";
const env = import.meta.env;
export const authConfig = {
  url: env.VITE_KEYCLOAK_URL ?? "http://localhost:8080",
  realm: env.VITE_KEYCLOAK_REALM ?? "tutor",
  clientId: env.VITE_KEYCLOAK_CLIENT_ID ?? "tutor-web",
};
export const keycloak = new Keycloak(authConfig);
export const authRedirectUri = new URL("/", location.origin).href;
let initialization: Promise<boolean> | undefined;
async function initialize(resumeSession: boolean) {
  const authenticated = await keycloak.init({
    redirectUri: authRedirectUri,
    pkceMethod: "S256",
    checkLoginIframe: false,
    ...(resumeSession ? { onLoad: "check-sso" as const } : {}),
  });
  setTokenProvider(async () => {
    await keycloak.updateToken(30);
    return keycloak.token ?? "";
  });
  return authenticated;
}

export function initializeAuth(resumeSession = false) {
  return (initialization ??= initialize(resumeSession));
}
