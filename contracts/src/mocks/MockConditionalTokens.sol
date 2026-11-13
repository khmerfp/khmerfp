// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockConditionalTokens is ERC1155 {
    bool public transfersBlocked;

    error TransfersBlocked();

    constructor() ERC1155("") {}

    function mint(address account, uint256 id, uint256 amount) external {
        _mint(account, id, amount, "");
    }

    function setTransfersBlocked(bool blocked) external {
        transfersBlocked = blocked;
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) public override {
        if (transfersBlocked) revert TransfersBlocked();
        super.safeTransferFrom(from, to, id, value, data);
    }
}
