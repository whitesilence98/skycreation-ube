# XPMSE (XP32) Essential Deforming Bone Hierarchy

This reference lists the essential deforming bones in Skyrim XPMSE skeletons used for humanoid character skinning.

## 1. Torso & Head Chain
- `NPC Root [Root]` (Ground root / origin)
- `NPC COM [COM ]` (Center of Mass)
- `NPC Pelvis [Pelv]` (Hip / pelvis root)
- `NPC Spine [Spn0]` (Lower lumbar spine)
- `NPC Spine1 [Spn1]` (Mid-thoracic spine)
- `NPC Spine2 [Spn2]` (Upper chest spine / collarbone root)
- `NPC Neck [Neck]` (Neck vertebrae)
- `NPC Head [Head]` (Cranium root)
- `NPCEyeBone` (Eye pivot)

## 2. Arms & Hands (Left / Right)
- `NPC L Clavicle [LClv]` / `NPC R Clavicle [RClv]` (Shoulder / collarbone)
- `NPC L UpperArm [LUar]` / `NPC R UpperArm [RUar]` (Humerus)
- `NPC L UpperarmTwist1 [LUt1]` / `NPC R UpperarmTwist1 [RUt1]` (Upper arm bicep twist)
- `NPC L Forearm [LLar]` / `NPC R Forearm [RLar]` (Radius/ulna)
- `NPC L ForearmTwist1 [LLt1]` / `NPC R ForearmTwist1 [RLt1]` (Forearm lower twist)
- `NPC L ForearmTwist2 [LLt2]` / `NPC R ForearmTwist2 [RLt2]` (Forearm mid twist)
- `NPC L Hand [LHnd]` / `NPC R Hand [RHnd]` (Wrist / palm)
- Fingers (Thumb `00`–`02`, Index `10`–`12`, Middle `20`–`22`, Ring `30`–`32`, Pinky `40`–`42`).

## 3. Legs & Feet (Left / Right)
- `NPC L Thigh [LThg]` / `NPC R Thigh [RThg]` (Femur / hip joint)
- `NPC L Calf [LClf]` / `NPC R Calf [RClf]` (Tibia / knee joint)
- `NPC L RearCalf [LrClf]` / `NPC R RearCalf [RrClf]` (Calf shape helper)
- `NPC L Foot [Lft ]` / `NPC R Foot [Rft ]` (Ankle / foot)
- `NPC L Toe0 [LToe]` / `NPC R Toe0 [RToe]` (Toes / ball of foot)

## 4. Secondary Deformers (Belly, Breasts, Glutes)
- `NPC Belly` / `Belly`
- `L Breast01`, `L Breast02`, `L Breast03`
- `R Breast01`, `R Breast02`, `R Breast03`
- `NPC L Butt`, `NPC R Butt`

## 5. Non-Deforming Dummy Nodes (Pruned by Default)
- `SPH ...` (Havok physics collision spheres)
- `CME ...` / `MOV ...` (Character creation slider edit handles)
- `HDT ...` (Physics collision capsules)
- `Weapon...` (`WeaponSword`, `WeaponDagger`, `WeaponBow`, `Quiver`, `Shield`)
- `Camera...` (First-person / killcam camera markers)
