import { Connection, PublicKey } from "@solana/web3.js";

// On-chain mint authority / freeze authority check. Read-only RPC. Returns
// `undefined` for a field we couldn't determine (→ UNKNOWN in the gate), never
// throws — Stage-0 must stay fast and resilient.

export interface AuthorityInfo {
  mintAuthorityRevoked?: boolean;
  freezeAuthorityNull?: boolean;
}

export async function fetchAuthorities(conn: Connection, mint: string): Promise<AuthorityInfo> {
  try {
    const info = await conn.getParsedAccountInfo(new PublicKey(mint));
    const data = info.value?.data;
    if (data && typeof data === "object" && "parsed" in data) {
      const parsedInfo = (data.parsed as { info?: { mintAuthority?: string | null; freezeAuthority?: string | null } })
        .info;
      if (parsedInfo) {
        return {
          mintAuthorityRevoked: parsedInfo.mintAuthority == null,
          freezeAuthorityNull: parsedInfo.freezeAuthority == null,
        };
      }
    }
  } catch {
    /* unknown on any RPC error */
  }
  return {};
}
