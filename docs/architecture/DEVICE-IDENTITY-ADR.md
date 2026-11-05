# ADR: RADAR OS Device Identity

**Status:** Proposed; owner review required.
**Decision scope:** Architecture only. No device registration, credential provisioning, or attestation is implemented.

## Context

User identity and workspace membership in RADARMatrix do not identify a particular installed RADAR OS device. Secure device administration and device-to-cloud synchronization therefore require a separate device identity without turning a device into an unrestricted authority principal.

## Proposed model

Each device has:

- A stable opaque `device_id`, generated at first initialization.
- A device-generated asymmetric key pair stored in a device-protected local keystore where available; development scaffolding may use a clearly marked file-backed key, never production credentials.
- A registration record containing device ID, public key, owner relationship, workspace association(s), trust state, creation/rotation timestamps, and revocation metadata.
- A short-lived device authentication proof for cloud or local service requests.

A device is not a user and does not inherit all user permissions. Every consequential operation still needs the current user/workspace authority, operation scope, and approval policy.

## Lifecycle

1. **Registration:** an authenticated owner explicitly starts registration; server issues no implicit authority beyond the requested device association.
2. **Binding:** device is associated with one or more approved workspaces through an explicit membership record.
3. **Authentication:** device signs a nonce/request envelope; server checks key, trust state, expiry, audience, and workspace scope.
4. **Revocation:** revoked devices fail closed immediately for sync and administration.
5. **Rotation:** device requests a new key under an authenticated existing-device/user ceremony; old key is retired after confirmation.
6. **Loss/replacement:** owner revokes the old device, registers replacement, and retains audit history; no silent transfer.
7. **Recovery:** recovery requires an owner-approved recovery process; no agent or local app may recover authority by itself.

## Trust and attestation

Ordinary device authentication means possession of the registered private key. Hardware-backed attestation is a separate future capability and must not be implied by ordinary key authentication. Platform support differs across amd64 PCs, ARM laptops, boards, VMs, and live images.

## Security constraints

- Device credentials are never placed in agent prompts, task text, browser URLs, or general logs.
- Revoked or unknown devices fail closed.
- Device authentication cannot replace user authorization or workspace membership.
- Agents cannot access device keys or registration APIs.
- Development keys must be clearly labeled and excluded from production use.
- Device audit events include identity and outcome, not private key material.

## Open decisions

Owner approval is required for the registration ceremony, supported key algorithms, production keystore/TPM policy, multi-workspace device rules, recovery authority, and attestation roadmap.

## Implementation status

**NOT IMPLEMENTED.** No production device credentials, registration records, keys, or services are created by Stage 0.1.
