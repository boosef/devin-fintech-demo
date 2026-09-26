export type Role = "admin" | "reviewer";

export type MockUser = {
  id: string;
  email: string;
  role: Role;
};
