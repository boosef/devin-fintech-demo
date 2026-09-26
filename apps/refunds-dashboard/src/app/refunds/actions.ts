"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isRefundServiceError } from "@/lib/refunds/errors";
import { approveRefund, denyRefund } from "@/lib/refunds/service";

export type ActionState = { status: "idle" | "success" | "error"; message: string };

async function run(action: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (isRefundServiceError(error)) return { status: "error", message: error.message };
    console.error(error);
    return { status: "error", message: "Something went wrong. Nothing was changed." };
  }
  revalidatePath("/refunds");
  revalidatePath("/audit");
  return { status: "success", message: success };
}

export async function approveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  const user = await getCurrentUser();
  return run(() => approveRefund({ user, id, note }), "Refund approved.");
}

export async function denyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const user = await getCurrentUser();
  return run(() => denyRefund({ user, id, reason }), "Refund denied.");
}
