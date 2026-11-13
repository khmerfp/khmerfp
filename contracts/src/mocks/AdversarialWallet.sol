// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract AdversarialWallet is IERC1271, ERC1155Holder {
    address public immutable owner;
    bool public signaturesEnabled = true;
    bool public rejectReceipt;
    address public target;
    bytes public payload;
    bytes4 public callbackError;
    bool public callbackSucceeded;

    constructor(address owner_) { owner = owner_; }
    function configure(bool enabled, bool reject_, address target_, bytes calldata payload_) external {
        require(msg.sender == owner, "owner only");
        signaturesEnabled = enabled;
        rejectReceipt = reject_;
        target = target_;
        payload = payload_;
    }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return signaturesEnabled && ECDSA.recover(hash, signature) == owner
            ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
    function execute(address destination, bytes calldata data) external {
        require(msg.sender == owner, "owner only");
        (bool ok, bytes memory result) = destination.call(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
    }
    function onERC1155Received(address, address, uint256, uint256, bytes memory)
        public override returns (bytes4)
    {
        require(!rejectReceipt, "receipt rejected");
        if (target != address(0)) {
            (bool ok, bytes memory result) = target.call(payload);
            callbackSucceeded = ok;
            if (result.length >= 4) callbackError = bytes4(result);
        }
        return this.onERC1155Received.selector;
    }
}
