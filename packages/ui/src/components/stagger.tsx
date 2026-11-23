"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { staggerDelay, transitions } from "../lib/motion";

type StaggerItemProps = HTMLMotionProps<"li"> & { index: number };

/** A list row that fades/slides in, delayed by its index (30ms steps, capped at 10). */
export function StaggerItem({ index, ...props }: StaggerItemProps) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitions.micro, delay: staggerDelay(index) }}
      {...props}
    />
  );
}
