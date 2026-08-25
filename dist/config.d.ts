import { type TodoMdConfig } from "./domain.js";
export declare const DEFAULT_CONFIG: TodoMdConfig;
export declare function loadConfig(root: string): TodoMdConfig;
export declare function loadConfigFile(file: string): TodoMdConfig;
