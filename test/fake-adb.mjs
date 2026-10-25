#!/usr/bin/env node
// Stand-in for the adb binary. Appends its argv (as JSON) to $FAKE_ADB_LOG and prints canned output.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_ADB_LOG) appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(args) + "\n");
const serial = args[1];
if (args[0] === "connect") console.log("already connected to " + args[1]);
else if (args[0] === "devices") console.log(`List of devices attached\n${process.env.FAKE_ADB_SERIAL ?? "10.0.0.5:5555"}\tdevice\n`);
else if (args.includes("dumpsys") && args.includes("activities")) console.log(`  topResumedActivity=ActivityRecord{1 u0 ${process.env.FAKE_ADB_FG ?? "com.amazon.tv.launcher"}/.Main t1}`);
else if (args.includes("dumpsys") && args.includes("power")) console.log("mWakefulness=Awake");
else if (args.includes("am")) console.log("Starting: Intent {}\nStatus: ok");
else if (serial === undefined) process.exit(1);
