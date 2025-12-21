# Project Workflow

## Guiding Principles

1. **The Plan is the Source of Truth:** All work must be tracked in `plan.md`
2. **The Tech Stack is Deliberate:** Changes to the tech stack must be documented in `tech-stack.md` *before* implementation
3. **Test-Driven Development:** Write unit tests before implementing functionality
4. **High Code Coverage:** Aim for >80% code coverage for all modules
5. **User Experience First:** Every decision should prioritize user experience
6. **Non-Interactive & CI-Aware:** Prefer non-interactive commands. Use `CI=true` for watch-mode tools.

## Task Workflow

All tasks follow a strict lifecycle:

### Standard Task Workflow

1. **Select Task:** Choose the next available task from `plan.md` in sequential order
2. **Mark In Progress:** Edit `plan.md` and change the task from `[ ]` to `[~]`
3. **Write Failing Tests (Red Phase):** Create tests that define expected behavior
4. **Implement to Pass Tests (Green Phase):** Write minimum code to pass tests
5. **Refactor:** Improve code clarity without changing behavior
6. **Verify Coverage:** Run coverage reports (target: >80%)
7. **Document Deviations:** If implementation differs from tech stack, update docs first
8. **Commit Code Changes:** Stage and commit with clear message
9. **Attach Task Summary with Git Notes:** Add detailed note to commit
10. **Update Plan with SHA:** Mark task `[x]` and append commit SHA

### Phase Completion Protocol

After completing all tasks in a phase:

1. **Announce Protocol Start**
2. **Ensure Test Coverage for Phase Changes**
3. **Execute Automated Tests with Proactive Debugging**
4. **Propose Manual Verification Plan**
5. **Await User Feedback**
6. **Create Checkpoint Commit**
7. **Attach Verification Report using Git Notes**
8. **Update Plan with Checkpoint SHA**

### Quality Gates

Before marking any task complete:

- [ ] All tests pass
- [ ] Code coverage meets requirements (>80%)
- [ ] Code follows project's style guidelines
- [ ] All public functions documented
- [ ] Type safety enforced
- [ ] No linting errors
- [ ] Mobile works (if applicable)
- [ ] Documentation updated
- [ ] No security vulnerabilities

## Commit Guidelines

### Message Format
```
<type>(<scope>): <description>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting
- `refactor`: Code change (no new feature/fix)
- `test`: Adding tests
- `chore`: Maintenance

## Definition of Done

A task is complete when:

1. All code implemented to specification
2. Unit tests written and passing
3. Code coverage meets requirements
4. Documentation complete
5. Code passes linting/static analysis
6. Changes committed with proper message
7. Git note with task summary attached
