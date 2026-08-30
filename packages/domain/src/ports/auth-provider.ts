export type AuthProvider = {
  createCredentialsUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<{ externalAuthId: string }>;
};
