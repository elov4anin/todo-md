import { type IdIndex, type TodoMdConfig, type ValidationResult } from "./domain.js";
export declare function validateFile(file: string, idIndex: IdIndex, config?: TodoMdConfig): ValidationResult;
export declare function checkOnBoard(root: string, file: string): ValidationResult;
