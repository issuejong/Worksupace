import type { ReactNode } from "react";
import Planner from "../planner";

export default function PlannerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Planner />
      {children}
    </>
  );
}
