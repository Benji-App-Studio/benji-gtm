"use client";
// Whether the page is drawn inside the example app (/example): read-only, on sample data. Components
// that point at the example themselves, or that would write, ask this (components/example).
import { createContext, useContext } from "react";

export const ExampleContext = createContext(false);
export const useExample = () => useContext(ExampleContext);
