import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

const passwordRequirements = {
  minLength: 10,
  hasUpperCase: (s: string) => /[A-Z]/.test(s),
  hasLowerCase: (s: string) => /[a-z]/.test(s),
  hasNumber: (s: string) => /\d/.test(s),
  hasSpecial: (s: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(s),
};

export const forceResetSchema = z
  .object({
    password: z
      .string()
      .min(
        passwordRequirements.minLength,
        `Password must be at least ${passwordRequirements.minLength} characters`
      )
      .refine(passwordRequirements.hasUpperCase, "Include at least one uppercase letter")
      .refine(passwordRequirements.hasLowerCase, "Include at least one lowercase letter")
      .refine(passwordRequirements.hasNumber, "Include at least one number")
      .refine(passwordRequirements.hasSpecial, "Include at least one special character"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ForceResetInput = z.infer<typeof forceResetSchema>;
