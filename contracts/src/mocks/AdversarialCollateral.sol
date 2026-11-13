// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// test-only transfer faults and callback attempts.
contract AdversarialCollateral is ERC20 {
    uint256 public mode;
    address public target;
    bytes public payload;
    bytes4 public callbackError;
    bool public callbackSucceeded;

    constructor() ERC20("Adversarial collateral", "BAD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint256 mode_, address target_, bytes calldata payload_) external {
        mode = mode_;
        target = target_;
        payload = payload_;
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (mode == 1) return true;
        if (mode == 2) return false;
        if (mode == 3) revert("malicious token failure");
        if (mode == 4) {
            _spendAllowance(from, msg.sender, value);
            _transfer(from, to, value - 1);
            _burn(from, 1);
            return true;
        }
        if (mode == 5) {
            (bool ok, bytes memory result) = target.call(payload);
            callbackSucceeded = ok;
            if (result.length >= 4) callbackError = bytes4(result);
        }
        return super.transferFrom(from, to, value);
    }
}
