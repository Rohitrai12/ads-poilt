"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

type Step = {
  id: string;
  title: string;
  status: "pending" | "running" | "success" | "error";
  logs?: string;
};

export default function ToolSteps({
  steps,
  isLoading,
}: {
  steps: Step[];
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(true);

  // Auto-expand while generating, collapse after
  useEffect(() => {
    setOpen(isLoading);
  }, [isLoading]);

  if (!steps.length) return null;

  return (
    <div className="mt-4 border rounded-2xl bg-zinc-900 text-white">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 rounded-2xl"
      >
        <span className="font-medium">Tool Activity</span>
        <ChevronDown
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Content */}
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className="p-3 rounded-xl bg-zinc-800 border border-zinc-700"
            >
              <div className="flex items-center gap-2">
                <StatusDot status={step.status} />
                <span className="text-sm font-medium">{step.title}</span>
              </div>

              {step.logs && (
                <pre className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap">
                  {step.logs}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Step["status"] }) {
  const map = {
    pending: "bg-gray-500",
    running: "bg-yellow-400 animate-pulse",
    success: "bg-green-500",
    error: "bg-red-500",
  };

  return <div className={`w-2 h-2 rounded-full ${map[status]}`} />;
}