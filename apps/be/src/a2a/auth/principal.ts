/** An authenticated caller of the A2A transport. */
export interface Principal {
  /** Caller id: a peer project id, or the human user id. */
  id: string;
  /** 'user' = human via UI (broadly allowed); 'peer' = another project agent. */
  kind: 'user' | 'peer';
}
