import { describe, it, expect } from "vitest";
import {
  buildChatMessages,
  DEXTER_SYSTEM_PROMPT,
  type PromptHistoryTurn,
} from "../../src/generator/prompt";

describe("buildChatMessages", () => {
  it("should create basic message structure without history", () => {
    const input = "list memory";
    const messages = buildChatMessages(input);

    expect(messages).toHaveLength(2); // System, User
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(DEXTER_SYSTEM_PROMPT);

    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("User request:\nlist memory");
    expect(messages[1].content).toContain("Output only the command.");
  });

  it("should inject extra system prompt and instructions", () => {
    const input = "list files";
    const messages = buildChatMessages(input, {
      extraSystemPrompt: "DONT BE RUDE.",
      extraInstruction: "Be extremely accurate.",
    });

    expect(messages[0].content).toContain(DEXTER_SYSTEM_PROMPT);
    expect(messages[0].content).toContain("DONT BE RUDE.");

    expect(messages[1].content).toContain("User request:\nlist files");
    expect(messages[1].content).toContain("Be extremely accurate.");
  });

  it("should format session history correctly", () => {
    const history: PromptHistoryTurn[] = [
      { request: "say hello", command: "echo hello", status: "success", output: "hello\n" },
    ];
    
    const messages = buildChatMessages("do it again", { history });

    expect(messages).toHaveLength(5); // system + (user/assistant/user for history) + current user

    const [sys, hUserReq, hAsstCmd, hUserStatus, curUserReq] = messages;

    expect(sys.role).toBe("system");
    
    // Check history formatting
    expect(hUserReq.role).toBe("user");
    expect(hUserReq.content).toBe("User request: say hello");

    expect(hAsstCmd.role).toBe("assistant");
    expect(hAsstCmd.content).toBe("echo hello");

    expect(hUserStatus.role).toBe("user");
    expect(hUserStatus.content).toContain("Command execution status: success");
    expect(hUserStatus.content).toContain("Output:\nhello");

    expect(curUserReq.role).toBe("user");
    expect(curUserReq.content).toContain("do it again");
  });

  it("should omit assistant block if command generation failed", () => {
    // If command generation failed, 'command' is set to "-"
    const history: PromptHistoryTurn[] = [
      { request: "do something impossible", command: "-", status: "generation_failed" },
    ];
    
    const messages = buildChatMessages("retry", { history });

    // array length without assistant block
    expect(messages).toHaveLength(4); // system, hUserReq, hUserStatus, curUserReq
    
    // Check that assistant role is omitted
    const hasAssistant = messages.some(msg => msg.role === "assistant");
    expect(hasAssistant).toBe(false);

    const [, hUserReq, hUserStatus] = messages;
    expect(hUserReq.role).toBe("user");
    expect(hUserReq.content).toBe("User request: do something impossible");

    expect(hUserStatus.role).toBe("user");
    expect(hUserStatus.content).toBe("Command execution status: generation_failed"); // exact match without \nOutput:
  });

  it("should gracefully handle empty or undefined output in history", () => {
    const history: PromptHistoryTurn[] = [
      { request: "clear screen", command: "clear", status: "success", output: "   \n  " }, // whitespace only
      { request: "noop", command: "true", status: "success", output: undefined } // undefined
    ];
    
    const messages = buildChatMessages("next", { history });

    // Ensure no unexpected output headers are appended
    const hUserStatus1 = messages[3];
    expect(hUserStatus1.content).toBe("Command execution status: success");

    const hUserStatus2 = messages[6];
    expect(hUserStatus2.content).toBe("Command execution status: success");
  });
});
